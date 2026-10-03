import type { SessionId, DomainEvent } from "@polaris/protocol";
import { Deferred, Effect, Exit, Scope, Semaphore, Predicate } from "effect";
import type { EventStore } from "../store/EventStore.ts";
import type { SessionRecord } from "../store/model.ts";

type Store = EventStore["Service"];

interface Admission {
  readonly pin: Effect.Effect<void>;
  readonly enter: Effect.Effect<boolean>;
  readonly leave: Effect.Effect<void>;
}

const closedAdmission: Admission = {
  pin: Effect.void,
  enter: Effect.succeed(false),
  leave: Effect.void,
};

const admissions = new WeakMap<Store, Map<SessionId, Admission>>();

const registrations = new WeakMap<Store, Map<SessionId, Deferred.Deferred<Admission>>>();

interface AssignmentSource {
  readonly check: (sessionId: SessionId) => Effect.Effect<boolean>;
  /** False must prove the durable index has no assignment for this Session. */
  readonly relevant: ((sessionId: SessionId) => boolean) | undefined;
}

const sources = new WeakMap<Store, Set<AssignmentSource>>();

/** Mount assignment facts before rebuilding controllers so inputs cannot pass the restart gap. */
export const registerWorkerAdmissionSource = (
  store: Store,
  scope: Scope.Scope,
  check: AssignmentSource["check"],
  relevant?: AssignmentSource["relevant"]
) =>
  Effect.gen(function* () {
    let entries = sources.get(store);

    if (entries === undefined) {
      entries = new Set();
      sources.set(store, entries);
    }

    const source = { check, relevant };
    entries.add(source);
    const current = entries;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        current.delete(source);
      })
    );
  });

const hasAssignment = (store: Store, sessionId: SessionId) =>
  Effect.gen(function* () {
    for (const source of sources.get(store) ?? [])
      if (source.relevant?.(sessionId) !== false && (yield* source.check(sessionId))) return true;

    return false;
  });

const unassigned = (store: Store, sessionId: SessionId) => {
  if (admissions.get(store)?.has(sessionId)) return false;

  for (const source of sources.get(store) ?? [])
    if (source.relevant?.(sessionId) !== false) return false;

  return true;
};

/** A failed assignment fences input only while the durable assignment remains active. */
export const clearClosedWorkerAdmission = (store: Store, sessionId: SessionId) =>
  Effect.gen(function* () {
    const entries = admissions.get(store);

    if (entries?.get(sessionId) !== closedAdmission || (yield* hasAssignment(store, sessionId)))
      return false;

    if (entries.get(sessionId) !== closedAdmission) return false;
    entries.delete(sessionId);

    return true;
  });

const awaitRegistration = (store: Store, sessionId: SessionId) =>
  Effect.suspend(() => {
    const current = admissions.get(store)?.get(sessionId);

    if (current !== undefined) return Effect.succeed(current);
    let waiting = registrations.get(store);

    if (waiting === undefined) {
      waiting = new Map();
      registrations.set(store, waiting);
    }

    let ready = waiting.get(sessionId);

    if (ready === undefined) {
      ready = Deferred.makeUnsafe<Admission>();
      waiting.set(sessionId, ready);
    }

    return Deferred.await(ready);
  });

/** A terminal mirror can retire an input that arrived before its admission controller mounted. */
export const cancelWorkerAdmissionWait = (store: Store, sessionId: SessionId) =>
  Effect.gen(function* () {
    yield* clearClosedWorkerAdmission(store, sessionId);
    const waiting = registrations.get(store);
    const registration = waiting?.get(sessionId);

    if (registration === undefined) return;
    waiting?.delete(sessionId);
    yield* Deferred.succeed(registration, closedAdmission);
  });

/** Foreground and background work retain capacity; only a quiescent blocked wait releases it. */
export const workerBusy = (record: SessionRecord | undefined) =>
  record === undefined ||
  record.turns.some((turn) => turn.status === "working") ||
  record.session.backgroundTasks.length > 0 ||
  record.subagents.size > 0;

/** Keep the assignment registered while replacing only its FIFO admission scope. */
export const registerWorkerAdmission = <E>(
  store: Store,
  sessionId: SessionId,
  parent: Scope.Scope,
  acquire: Effect.Effect<void, E, Scope.Scope>,
  mayRelease: Effect.Effect<boolean>
) =>
  Effect.gen(function* () {
    const gate = yield* Semaphore.make(1);
    let slot: { scope: Scope.Closeable; ready: Deferred.Deferred<boolean, E> } | undefined;
    let closed = false;
    let pins = 0;

    const record = (yield* store.model).sessions.get(sessionId);

    const background = new Set(
      [...(record?.subagents.values() ?? [])].flatMap((s) => (s.background === true ? [s.id] : []))
    );

    let hasTasks = (record?.session.backgroundTasks.length ?? 0) > 0;
    let reportsPending = background.size > 0 || hasTasks;

    const release = Effect.gen(function* () {
      const previous = slot;
      slot = undefined;

      if (previous === undefined) return;
      yield* Deferred.succeed(previous.ready, false);
      yield* Scope.close(previous.scope, Exit.void);
    });

    const suspend = gate.withPermit(
      Effect.gen(function* () {
        if (pins === 0 && !reportsPending && (yield* mayRelease)) yield* release;
      })
    );

    const ensure = Effect.gen(function* () {
      const current = yield* gate.withPermit(
        Effect.gen(function* () {
          if (closed) return undefined;

          if (slot !== undefined) return slot;
          const scope = yield* Scope.fork(parent);
          const ready = yield* Deferred.make<boolean, E>();
          slot = { scope, ready };
          yield* acquire.pipe(
            Effect.andThen(Deferred.succeed(ready, true)),
            Effect.catch((error) => Deferred.fail(ready, error)),
            Scope.provide(scope),
            Effect.forkIn(scope)
          );

          return slot;
        })
      );

      if (current === undefined) return false;

      return yield* Deferred.await(current.ready).pipe(
        Effect.onError(() =>
          gate.withPermit(
            Effect.gen(function* () {
              if (slot === current) yield* release;
            })
          )
        )
      );
    });

    const admission: Admission = {
      pin: Effect.sync(() => {
        pins++;
      }),
      enter: ensure.pipe(Effect.orDie),
      leave: Effect.sync(() => pins--).pipe(Effect.andThen(suspend)),
    };

    let registered = admissions.get(store);

    if (registered === undefined) {
      registered = new Map();
      admissions.set(store, registered);
    }

    registered.set(sessionId, admission);
    const waiting = registrations.get(store);
    const registration = waiting?.get(sessionId);

    if (registration !== undefined) {
      waiting?.delete(sessionId);
      yield* Deferred.succeed(registration, admission);
    }

    const entries = registered;

    // Keep failure visible while assigned; replacement or terminal assignment cleanup removes it.
    const retire = gate.withPermit(
      Effect.gen(function* () {
        closed = true;

        if (entries.get(sessionId) === admission) entries.set(sessionId, closedAdmission);
        yield* release;
      })
    );

    yield* Scope.addFinalizer(
      parent,
      gate.withPermit(
        Effect.gen(function* () {
          closed = true;

          if (entries.get(sessionId) === admission) entries.delete(sessionId);
          yield* clearClosedWorkerAdmission(store, sessionId);
          yield* release;
        })
      )
    );

    const observe = (event: DomainEvent) =>
      Effect.gen(function* () {
        if (
          Predicate.isTagged(event, "SubagentStarted") &&
          event.subagent.sessionId === sessionId &&
          event.subagent.background === true
        ) {
          background.add(event.subagent.id);
          reportsPending = true;
        }

        if (Predicate.isTagged(event, "SubagentEnded") && event.subagent.sessionId === sessionId)
          background.delete(event.subagent.id);

        if (
          Predicate.isTagged(event, "SessionBackgroundTasksChanged") &&
          event.sessionId === sessionId
        ) {
          hasTasks = event.tasks.length > 0;

          if (hasTasks) reportsPending = true;
        }

        if (Predicate.isTagged(event, "TurnEnded") && event.turn.sessionId === sessionId) {
          reportsPending = event.turn.status === "completed" && (hasTasks || background.size > 0);
        }

        if (
          Predicate.isTagged(event, "SessionStateChanged") &&
          event.sessionId === sessionId &&
          ["dormant", "failed", "archived"].includes(event.state)
        )
          reportsPending = false;
        yield* suspend;
      });

    return { ensure, suspend, observe, retire };
  });

export const hasWorkerAdmission = (store: Store, sessionId: SessionId) =>
  admissions.get(store)?.has(sessionId) === true;

/** Pin admission through the atomic delivery commit and its execution side effect. */
export const withWorkerAdmission = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
  waitForRegistration = false
): Effect.Effect<A | void, E, R> =>
  Effect.suspend(() => {
    if (!waitForRegistration && unassigned(store, sessionId)) return effect;

    return Effect.gen(function* () {
      if (yield* clearClosedWorkerAdmission(store, sessionId)) return yield* effect;

      const admission =
        admissions.get(store)?.get(sessionId) ??
        (waitForRegistration || (yield* hasAssignment(store, sessionId))
          ? yield* awaitRegistration(store, sessionId)
          : undefined);

      if (admission === undefined) return yield* effect;

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* admission.pin;

          return yield* restore(admission.enter).pipe(
            Effect.flatMap((ready): Effect.Effect<A | void, E, R> =>
              ready ? restore(effect) : Effect.void
            ),
            Effect.ensuring(admission.leave)
          );
        })
      );
    });
  });
