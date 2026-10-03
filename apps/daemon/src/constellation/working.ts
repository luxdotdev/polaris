import type { Attempt, AttemptId, SessionId, DomainEvent } from "@polaris/protocol";
import { Deferred, Effect, Exit, Layer, Predicate, Scope, Stream } from "effect";
import {
  cancelWorkerAdmissionWait,
  registerWorkerAdmission,
  registerWorkerAdmissionSource,
  workerBusy,
} from "../resources/workerAdmission.ts";
import { graphEvent } from "../store/constellation.ts";
import { EventStore } from "../store/EventStore.ts";
import { ConstellationRuntime, type ConstellationRuntimeService } from "./runtime.ts";

export interface WorkingAttemptHooks<E> {
  readonly runtime: ConstellationRuntimeService;
  readonly ownsAttempt?: (attempt: Attempt) => boolean;
  /** HostResources.acquireWorker; the slot belongs to a replaceable admission scope. */
  readonly acquireWorker: (sessionId: SessionId) => Effect.Effect<void, E, Scope.Scope>;
  /** Commit the title/first prompt via the Session machine and pass its Harness attachment. */
  readonly startWorker: (attempt: Attempt) => Effect.Effect<void, E>;
  /** Resume an existing assignment; never submit a new first Turn. */
  readonly resumeWorker: (attempt: Attempt) => Effect.Effect<void, E>;
  readonly eventCommitted?: (event: DomainEvent) => Effect.Effect<void>;
  readonly failed: (attempt: Attempt, error: E) => Effect.Effect<void>;
}

/** FIFO slot waits run after commit; Claim, settle and shutdown close the working scope. */
export const workingAttemptsLayer = <E>(hooks: WorkingAttemptHooks<E>) =>
  Layer.effect(
    ConstellationRuntime,
    Effect.gen(function* () {
      const store = yield* EventStore;
      const parent = yield* Scope.Scope;
      yield* registerWorkerAdmissionSource(store, parent, (sessionId) =>
        Effect.map(store.model, (model) =>
          [...model.constellations.values()].some(
            (record) =>
              record.graph.state !== "completed" &&
              record.graph.state !== "archived" &&
              record.graph.attempts.some(
                (attempt) =>
                  attempt.sessionId === sessionId &&
                  hooks.ownsAttempt?.(attempt) !== false &&
                  (attempt.state === "working" || attempt.state === "blocked") &&
                  record.graph.attempts.findLast((a) => a.taskId === attempt.taskId)?.id ===
                    attempt.id &&
                  !record.stale.has(attempt.id)
              )
          )
        )
      );

      const working = new Map<
        AttemptId,
        { scope: Scope.Closeable; observe: (event: DomainEvent) => Effect.Effect<void> }
      >();

      const close = Effect.fnUntraced(function* (id: AttemptId) {
        const entry = working.get(id);

        if (entry === undefined) {
          for (const record of (yield* store.model).constellations.values()) {
            const attempt = record.graph.attempts.find((a) => a.id === id);

            if (attempt !== undefined) yield* cancelWorkerAdmissionWait(store, attempt.sessionId);
          }

          return;
        }

        working.delete(id);
        yield* Scope.close(entry.scope, Exit.void);
      });

      let sequence = 0;
      const ready = yield* Deferred.make<void>();

      const closeArchived = Effect.fnUntraced(function* (event: DomainEvent) {
        if (Predicate.isTagged(event, "ConstellationStateChanged") && event.state === "archived") {
          const record = (yield* store.model).constellations.get(event.constellationId);

          for (const attempt of record?.graph.attempts ?? []) yield* close(attempt.id);
        }

        if (Predicate.isTagged(event, "SessionStateChanged") && event.state === "archived") {
          for (const record of (yield* store.model).constellations.values())
            for (const attempt of record.graph.attempts)
              if (attempt.sessionId === event.sessionId) yield* close(attempt.id);
        }
      });

      const committed = Effect.fnUntraced(function* (event: DomainEvent) {
        if (hooks.eventCommitted !== undefined) yield* hooks.eventCommitted(event);

        yield* closeArchived(event);

        for (const entry of working.values()) yield* entry.observe(event);

        const graph = graphEvent(event);

        if (graph === null || !("attemptId" in graph)) return;

        if (
          Predicate.isTagged(graph, "AttemptClaimed") ||
          Predicate.isTagged(graph, "AttemptAccepted") ||
          Predicate.isTagged(graph, "AttemptRejected") ||
          Predicate.isTagged(graph, "AttemptSettled")
        )
          yield* close(graph.attemptId);
      });

      const observe = Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* store.subscribe({
            filter: (item) =>
              Predicate.isTagged(item, "Event") &&
              (graphEvent(item.envelope.event) !== null ||
                Predicate.isTagged(item.envelope.event, "SessionStateChanged") ||
                Predicate.isTagged(item.envelope.event, "TurnEnded") ||
                Predicate.isTagged(item.envelope.event, "SessionBackgroundTasksChanged") ||
                Predicate.isTagged(item.envelope.event, "SubagentStarted") ||
                Predicate.isTagged(item.envelope.event, "SubagentEnded")),
          });

          const cut = (yield* store.model).sequence;

          const replay = yield* store
            .readEvents({ after: sequence, upTo: cut, sessionId: null })
            .pipe(Effect.orDie);

          const suffix = [...replay];

          for (const record of (yield* store.model).constellations.values())
            suffix.push(
              ...(yield* store
                .readConstellationEvents({
                  constellationId: record.graph.id,
                  after: sequence,
                  upTo: cut,
                })
                .pipe(Effect.orDie))
            );
          const ordered = new Map(suffix.map((envelope) => [envelope.sequence, envelope]));

          for (const envelope of [...ordered.values()].sort((a, b) => a.sequence - b.sequence))
            yield* committed(envelope.event);
          sequence = cut;
          yield* Deferred.succeed(ready, undefined);
          yield* subscription.pipe(
            Stream.runForEach(
              Effect.fnUntraced(function* (item) {
                if (!Predicate.isTagged(item, "Event") || item.envelope.sequence <= sequence)
                  return;
                yield* committed(item.envelope.event);
                sequence = item.envelope.sequence;
              })
            )
          );
        })
      );

      // A bounded subscriber can close under load; replay the missed suffix before listening again.
      yield* observe.pipe(Effect.forever, Effect.forkIn(parent));
      yield* Deferred.await(ready);

      const start = Effect.fnUntraced(function* (attempt: Attempt, resume: boolean) {
        if (hooks.ownsAttempt?.(attempt) === false) return;
        const model = yield* store.model;

        const current = [...model.constellations.values()]
          .filter(
            (record) => record.graph.state !== "completed" && record.graph.state !== "archived"
          )
          .flatMap((record) => record.graph.attempts)
          .find((a) => a.id === attempt.id);

        if (
          (current?.state !== "working" && current?.state !== "blocked") ||
          working.has(attempt.id)
        )
          return;
        const scope = yield* Scope.fork(parent);

        const mayRelease = Effect.map(store.model, (model) => {
          const current = [...model.constellations.values()]
            .flatMap((r) => r.graph.attempts)
            .find((a) => a.id === attempt.id);

          return current?.state === "blocked" && !workerBusy(model.sessions.get(attempt.sessionId));
        });

        const admission = yield* registerWorkerAdmission(
          store,
          attempt.sessionId,
          scope,
          hooks.acquireWorker(attempt.sessionId),
          mayRelease
        );

        working.set(attempt.id, { scope, observe: admission.observe });
        yield* Effect.gen(function* () {
          if (!(yield* mayRelease) && !(yield* admission.ensure)) return;
          const latest = yield* store.model;

          if (
            ![...latest.constellations.values()].some(
              (r) =>
                r.graph.state !== "completed" &&
                r.graph.state !== "archived" &&
                r.graph.attempts.some(
                  (a) => a.id === attempt.id && (a.state === "working" || a.state === "blocked")
                )
            )
          )
            return;
          yield* resume ? hooks.resumeWorker(attempt) : hooks.startWorker(attempt);
          yield* admission.suspend;
        }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.catch((error) =>
            Effect.andThen(
              hooks.failed(attempt, error),
              close(attempt.id).pipe(Effect.forkIn(parent), Effect.asVoid)
            )
          ),
          Effect.forkIn(scope)
        );
      });

      return {
        prepare: hooks.runtime.prepare,
        resumeWorking: Effect.fnUntraced(function* () {
          yield* hooks.runtime.resumeWorking();

          for (const record of (yield* store.model).constellations.values()) {
            if (record.graph.state === "completed" || record.graph.state === "archived") continue;

            for (const attempt of record.graph.attempts)
              if (attempt.state === "working" || attempt.state === "blocked")
                yield* start(attempt, true);
          }
        }),
        afterCommit: Effect.fnUntraced(function* (binding, command, envelopes) {
          yield* hooks.runtime.afterCommit(binding, command, envelopes);

          for (const { event } of envelopes) {
            const graph = graphEvent(event);

            if (
              graph !== null &&
              (Predicate.isTagged(graph, "AttemptClaimed") ||
                Predicate.isTagged(graph, "AttemptAccepted") ||
                Predicate.isTagged(graph, "AttemptRejected") ||
                Predicate.isTagged(graph, "AttemptSettled"))
            )
              yield* close(graph.attemptId);

            if (Predicate.isTagged(event, "AttemptStarted")) yield* start(event.attempt, false);
          }
        }) satisfies ConstellationRuntimeService["afterCommit"],
      };
    })
  );
