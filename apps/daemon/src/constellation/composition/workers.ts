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
import type { ReadModel } from "../../store/model.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { newTurn, startedTurn, waitForDeliveryReady } from "../delivery/turns.ts";
import { acceptedDependencyClaims, effectiveDeps } from "../parents.ts";
import { recoverAttempt } from "../recovery.ts";
import { mergeFirst, reviewFeedback } from "./feedback.ts";

export const canStartAttempt = (graph: Constellation, attempt: Attempt) =>
  graph.state !== "completed" &&
  graph.state !== "archived" &&
  graph.attempts.findLast((a) => a.taskId === attempt.taskId)?.id === attempt.id &&
  graph.attempts.some((a) => a.id === attempt.id && a.state === "working");

type StartupGuard = (model: ReadModel) => Effect.Effect<boolean>;

const startupAllowed = (graph: Constellation, attempt: Attempt, model: ReadModel) => {
  const local = model.constellations.get(graph.id);

  return canStartAttempt(local?.graph ?? graph, attempt) && !local?.stale.has(attempt.id);
};

export const startAttempt = Effect.fn("Constellation.startAttempt")(function* (
  graph: Constellation,
  attempt: Attempt,
  guard: StartupGuard = () => Effect.succeed(true)
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const task = graph.tasks.find((t) => t.id === attempt.taskId);

  if (task === undefined) return;

  if (!startupAllowed(graph, attempt, yield* store.model) || !(yield* guard(yield* store.model)))
    return;

  if (!(yield* waitForDeliveryReady(attempt.sessionId, true))) return;
  const boundary = yield* store.model;

  if (!startupAllowed(graph, attempt, boundary) || !(yield* guard(boundary))) return;
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
    acceptedDeps: acceptedDependencyClaims(graph, effectiveDeps(graph.tasks, task.id)),
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
              decide: (current) =>
                Effect.gen(function* () {
                  const record = current.sessions.get(attempt.sessionId);

                  if (
                    record === undefined ||
                    !startupAllowed(graph, attempt, current) ||
                    !(yield* guard(current))
                  )
                    return yield* new CommandRejected({
                      commandId: CommandId.make(`${attempt.id}:start`),
                      reason: "Worker startup is no longer eligible",
                    });

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
                    return yield* new CommandRejected({
                      commandId: CommandId.make(`${attempt.id}:start`),
                      reason: "Worker startup is queued",
                    });

                  return [
                    DomainEvent.cases.SessionRenamed.make({
                      sessionId: attempt.sessionId,
                      title: `${task.id} · ${task.title}`,
                    }),
                    ...decision.events,
                  ];
                }),
            })
            .pipe(
              Effect.catchTag("CommandRejected", (error) =>
                Effect.succeed(error.reason === "Worker startup is queued" ? null : false)
              ),
              Effect.orDie
            );

          if (result === null) {
            yield* restore(feed.pipe(Stream.take(1), Stream.runDrain));

            return false;
          }

          if (result !== false && Predicate.isTagged(result, "Committed")) {
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

/** A committed Attempt with no startup receipt must still start after a Daemon restart. */
export const startPendingAttempt = Effect.fn("Constellation.startPendingAttempt")(function* (
  graph: Constellation,
  attempt: Attempt,
  guard: StartupGuard = () => Effect.succeed(true)
) {
  const store = yield* EventStore;

  if (yield* store.hasCommandReceipt(CommandId.make(`${attempt.id}:start`)).pipe(Effect.orDie))
    return false;

  if (!(yield* store.model).sessions.has(attempt.sessionId)) return false;

  if (!startupAllowed(graph, attempt, yield* store.model) || !(yield* guard(yield* store.model)))
    return false;

  yield* startAttempt(graph, attempt, guard);

  return true;
});

export const workerFailed = (
  attempt: Attempt,
  error: ResourceError | ConstellationTransferError | ServiceError
) => Effect.logError(`Constellation worker ${attempt.id} startup needs attention`, error);
