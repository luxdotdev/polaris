import {
  CommandId,
  CommandRejected,
  DomainEvent,
  type Attempt,
  type Constellation,
  type ResourceError,
  type ConstellationTransferError,
} from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import type { ServiceError } from "../../services.ts";
import { Engine } from "../../engine/Engine.ts";
import { decideSession } from "../../engine/session.ts";
import { workerBrief } from "../../harness/constellation/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { newTurn, startedTurn, waitForDeliveryReady } from "../delivery/turns.ts";
import { recoverAttempt } from "../recovery.ts";
import { mergeFirst, reviewFeedback } from "./feedback.ts";

export const startAttempt = Effect.fn("Constellation.startAttempt")(function* (
  graph: Constellation,
  attempt: Attempt
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const task = graph.tasks.find((t) => t.id === attempt.taskId);

  if (task === undefined) return;

  if (!(yield* waitForDeliveryReady(attempt.sessionId))) return;
  // Reopen at the boundary so Existing and Gate Sessions retain their Lead attachment and gain Worker tools.
  yield* effects.retire(attempt.sessionId);
  const model = yield* store.model;
  const session = model.sessions.get(attempt.sessionId)?.session;

  if (session === undefined) return;

  const brief = workerBrief({
    constellationId: graph.id,
    workspaceId: graph.workspaceId,
    task,
    attempt,
    selection: session,
    permissionMode: session.permissionMode,
    ...reviewFeedback(graph, attempt),
    acceptedDeps: graph.attempts.flatMap((a) =>
      a.state === "accepted" && a.claim !== null && task.deps.includes(a.taskId)
        ? [{ taskId: a.taskId, claim: a.claim }]
        : []
    ),
  });

  const prompt = [mergeFirst(attempt), brief].filter((text) => text !== "").join("\n\n");

  while (true) {
    const done = yield* Effect.scoped(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const feed = yield* store.subscribe({ sessionId: attempt.sessionId });

          const result = yield* store
            .commit({
              recordRejection: false,
              commandId: CommandId.make(`${attempt.id}:start`),
              decide: (current) => {
                const record = current.sessions.get(attempt.sessionId);

                if (record === undefined) return Effect.succeed([]);
                const local = current.constellations.get(graph.id);

                if (
                  local !== undefined &&
                  !local.graph.attempts.some((a) => a.id === attempt.id && a.state === "working")
                )
                  return Effect.succeed([]);

                const decision = decideSession(record, {
                  type: "turn.send",
                  turn: newTurn(
                    record.session,
                    prompt,
                    new Date().toISOString(),
                    `${attempt.id}:start`
                  ),
                });

                if (decision.rejection !== null)
                  return Effect.fail(
                    new CommandRejected({
                      commandId: CommandId.make(`${attempt.id}:start`),
                      reason: "Worker startup is queued",
                    })
                  );

                return Effect.succeed([
                  DomainEvent.cases.SessionRenamed.make({
                    sessionId: attempt.sessionId,
                    title: `${task.id} · ${task.title}`,
                  }),
                  ...decision.events,
                ]);
              },
            })
            .pipe(
              Effect.catchTag("CommandRejected", () => Effect.succeed(null)),
              Effect.orDie
            );

          if (result === null) {
            yield* restore(feed.pipe(Stream.take(1), Stream.runDrain));

            return false;
          }

          if (Predicate.isTagged(result, "Committed")) {
            const turn = startedTurn(result.envelopes.map((e) => e.event));

            if (turn !== undefined) yield* effects.runTurn(turn, prompt);
          }

          return true;
        })
      )
    );

    if (done) return;
  }
});

export const resumeAttempt = Effect.fn("Constellation.resumeAttempt")(function* (attempt: Attempt) {
  const store = yield* EventStore;
  const model = yield* store.model;

  const graph = [...model.constellations.values()].find((r) =>
    r.graph.attempts.some((a) => a.id === attempt.id)
  )?.graph;

  if (graph !== undefined && (yield* startPendingAttempt(graph, attempt))) return;

  const engine = yield* Engine;
  const candidate = engine.recoveredTurns.find((c) => c.sessionId === attempt.sessionId);

  if (candidate !== undefined) yield* recoverAttempt(candidate);
});

/** A committed retry with no first Turn must still start after a Daemon restart. */
export const startPendingAttempt = Effect.fn("Constellation.startPendingAttempt")(function* (
  graph: Constellation,
  attempt: Attempt
) {
  if (
    !Predicate.isTagged(attempt.cause, "SentBack") &&
    !Predicate.isTagged(attempt.cause, "MergeConflict")
  )
    return false;

  const store = yield* EventStore;
  const record = (yield* store.model).sessions.get(attempt.sessionId);

  if (record === undefined || record.turns.some((t) => t.id === `${attempt.id}:start`))
    return false;

  yield* startAttempt(graph, attempt);

  return true;
});

export const workerFailed = (
  attempt: Attempt,
  error: ResourceError | ConstellationTransferError | ServiceError
) => Effect.logError(`Constellation worker ${attempt.id} startup needs attention`, error);
