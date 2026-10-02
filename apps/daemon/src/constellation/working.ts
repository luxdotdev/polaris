import type { Attempt, AttemptId, SessionId, DomainEvent } from "@polaris/protocol";
import { Deferred, Effect, Exit, Layer, Predicate, Scope, Stream } from "effect";
import { graphEvent } from "../store/constellation.ts";
import { EventStore } from "../store/EventStore.ts";
import { ConstellationRuntime, type ConstellationRuntimeService } from "./runtime.ts";

export interface WorkingAttemptHooks<E> {
  readonly runtime: ConstellationRuntimeService;
  readonly ownsAttempt?: (attempt: Attempt) => boolean;
  /** HostResources.acquireWorker; the slot belongs to this Attempt's scope. */
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
      const working = new Map<AttemptId, Scope.Closeable>();

      const close = Effect.fnUntraced(function* (id: AttemptId) {
        const scope = working.get(id);

        if (scope === undefined) return;
        working.delete(id);
        yield* Scope.close(scope, Exit.void);
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
                Predicate.isTagged(item.envelope.event, "SessionStateChanged")),
          });

          const cut = (yield* store.model).sequence;

          const replay = yield* store
            .readEvents({ after: sequence, upTo: cut, sessionId: null })
            .pipe(Effect.orDie);

          for (const envelope of replay) yield* committed(envelope.event);
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

        if (current?.state !== "working" || working.has(attempt.id)) return;
        const scope = yield* Scope.fork(parent);
        working.set(attempt.id, scope);
        yield* Effect.gen(function* () {
          yield* hooks.acquireWorker(attempt.sessionId);
          const latest = yield* store.model;

          if (
            ![...latest.constellations.values()].some(
              (r) =>
                r.graph.state !== "completed" &&
                r.graph.state !== "archived" &&
                r.graph.attempts.some((a) => a.id === attempt.id && a.state === "working")
            )
          )
            return;
          yield* resume ? hooks.resumeWorker(attempt) : hooks.startWorker(attempt);
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
              if (attempt.state === "working") yield* start(attempt, true);
          }
        }),
        afterCommit: Effect.fnUntraced(function* (binding, command, envelopes) {
          yield* hooks.runtime.afterCommit(binding, command, envelopes);

          for (const { event } of envelopes)
            if (Predicate.isTagged(event, "AttemptStarted")) yield* start(event.attempt, false);
        }) satisfies ConstellationRuntimeService["afterCommit"],
      };
    })
  );
