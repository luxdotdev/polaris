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

const admissions = new WeakMap<Store, Map<SessionId, Admission>>();

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

    let reportsPending =
      [...(record?.subagents.values() ?? [])].some((s) => s.background === true) ||
      (record?.session.backgroundTasks.length ?? 0) > 0;

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
    const entries = registered;

    yield* Scope.addFinalizer(
      parent,
      gate.withPermit(
        Effect.gen(function* () {
          closed = true;

          if (entries.get(sessionId) === admission) entries.delete(sessionId);
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
        )
          reportsPending = true;

        if (
          Predicate.isTagged(event, "SessionBackgroundTasksChanged") &&
          event.sessionId === sessionId &&
          event.tasks.length > 0
        )
          reportsPending = true;

        if (
          Predicate.isTagged(event, "TurnEnded") &&
          event.turn.sessionId === sessionId &&
          (event.turn.status !== "completed" || event.turn.trigger !== null)
        )
          reportsPending = false;

        if (
          Predicate.isTagged(event, "SessionStateChanged") &&
          event.sessionId === sessionId &&
          ["dormant", "failed", "archived"].includes(event.state)
        )
          reportsPending = false;
        yield* suspend;
      });

    return { ensure, suspend, observe };
  });

export const hasWorkerAdmission = (store: Store, sessionId: SessionId) =>
  admissions.get(store)?.has(sessionId) === true;

/** Pin admission through the atomic delivery commit and its execution side effect. */
export const withWorkerAdmission = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A | void, E, R> =>
  Effect.suspend<A | void, E, R>(() => {
    const admission = admissions.get(store)?.get(sessionId);

    if (admission === undefined) return effect;

    return Effect.uninterruptibleMask((restore) =>
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
