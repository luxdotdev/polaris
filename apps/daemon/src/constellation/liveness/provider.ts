import {
  type Attempt,
  type AttemptId,
  type ConstellationId,
  type SessionId,
  ConstellationStreamItem,
  WorkerLiveness,
} from "@polaris/protocol";
import { type Cause, Effect, Queue, Stream } from "effect";
import {
  emptyLiveness,
  observeLiveness,
  projectLiveness,
  restoreLiveness,
  type LivenessFacts,
} from "../../harness/constellation/liveness.ts";
import { EventStore } from "../../store/EventStore.ts";
import { latestAttempt } from "../projections.ts";
import type { ConstellationLivenessDelegate } from "../liveness.ts";

type Update = Extract<ConstellationStreamItem, { _tag: "LivenessChanged" }>;

export const livenessProvider = Effect.gen(function* () {
  const store = yield* EventStore;
  const facts = new Map<AttemptId, LivenessFacts>();
  const queued = new Map<AttemptId, number>();
  const subscribers = new Map<ConstellationId, Set<Queue.Queue<Update, Cause.Done>>>();

  const wire = (attemptId: AttemptId) => {
    const projected = projectLiveness(
      facts.get(attemptId) ?? emptyLiveness(),
      Date.now(),
      queued.get(attemptId) ?? 0
    );

    const current = projected.current;

    return WorkerLiveness.make({
      current:
        current === null
          ? null
          : {
              itemId: current.itemId,
              turnId: current.turnId,
              command: current.command,
              startedAt: current.startedAt,
            },
      lastOutputAt: projected.lastOutputAt,
      contextPercent: projected.contextPercent,
      queuedInput: projected.queuedInput,
    });
  };

  const publish = Effect.fnUntraced(function* (
    sessionId: SessionId,
    update: (attempt: Attempt) => void
  ) {
    const model = yield* store.model;

    const assignment = [...model.constellations.values()]
      .flatMap((record) =>
        record.graph.attempts
          .filter(
            (a) => a.sessionId === sessionId && latestAttempt(record.graph, a.taskId)?.id === a.id
          )
          .map((attempt) => ({ record, attempt }))
      )
      .sort((a, b) => a.attempt.startedAt.localeCompare(b.attempt.startedAt))
      .at(-1);

    if (assignment === undefined) return;
    const { record, attempt } = assignment;
    update(attempt);

    const item = ConstellationStreamItem.cases.LivenessChanged.make({
      attemptId: attempt.id,
      liveness: wire(attempt.id),
    });

    for (const queue of subscribers.get(record.graph.id) ?? []) Queue.offerUnsafe(queue, item);
  });

  const service = {
    read: Effect.fnUntraced(function* (record) {
      const result = new Map<AttemptId, WorkerLiveness>();
      const cut = (yield* store.model).sequence;

      for (const task of record.graph.tasks) {
        const attempt = latestAttempt(record.graph, task.id);

        if (attempt === undefined) continue;

        if (!facts.has(attempt.id)) {
          const history = yield* store
            .readEvents({ after: 0, upTo: cut, sessionId: attempt.sessionId })
            .pipe(Effect.orDie);

          facts.set(
            attempt.id,
            history
              .filter(
                (e) =>
                  e.occurredAt >= attempt.startedAt &&
                  (attempt.endedAt === null || e.occurredAt <= attempt.endedAt)
              )
              .reduce(
                (value, envelope) =>
                  restoreLiveness(value, envelope.event, Date.parse(envelope.occurredAt)),
                emptyLiveness()
              )
          );
        }

        result.set(attempt.id, wire(attempt.id));
      }

      return result;
    }),
    subscribe: Effect.fnUntraced(function* (id) {
      const queue = yield* Queue.sliding<Update, Cause.Done>(256);
      const bucket = subscribers.get(id) ?? new Set();
      bucket.add(queue);
      subscribers.set(id, bucket);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          bucket.delete(queue);

          if (bucket.size === 0) subscribers.delete(id);
          Queue.endUnsafe(queue);
        })
      );

      return Stream.fromQueue(queue);
    }),
    observe: Effect.fnUntraced(function* (sessionId, event, at, queuedInput) {
      yield* publish(sessionId, (attempt) => {
        facts.set(attempt.id, observeLiveness(facts.get(attempt.id) ?? emptyLiveness(), event, at));

        if (queuedInput !== undefined) queued.set(attempt.id, queuedInput);
      });
    }),
    queued: Effect.fnUntraced(function* (sessionId, count) {
      yield* publish(sessionId, (attempt) => {
        queued.set(attempt.id, count);
      });
    }),
  } satisfies ConstellationLivenessDelegate;

  return service;
});
