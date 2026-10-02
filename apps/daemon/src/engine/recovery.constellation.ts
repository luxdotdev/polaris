import { ConstellationEvent, type DomainEvent, type SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import type { ReadModel, SessionRecord } from "../store/model.ts";
import type { EngineRuntime } from "./runtime.ts";
import { decideSession } from "./session.ts";

/** Evidence is recorded in the same batch as daemon.recover, before approvals are withdrawn. */
const interruptionEvents = (
  model: ReadModel,
  record: SessionRecord,
  at: string
): ReadonlyArray<DomainEvent> => {
  const turn = record.turns.find((t) => t.status === "working");

  if (turn === undefined) return [];

  return [...model.constellations.values()].flatMap((r) => {
    if (
      r.graph.leadSessionId === record.session.id ||
      r.graph.state === "completed" ||
      r.graph.state === "archived"
    )
      return [];
    const attempt = r.graph.attempts.findLast((a) => a.sessionId === record.session.id);

    if (
      attempt === undefined ||
      attempt.state !== "working" ||
      attempt.hostId !== r.graph.hostId ||
      turn.startedAt < attempt.startedAt
    )
      return [];

    return [
      ConstellationEvent.cases.AttemptInterrupted.make({
        constellationId: r.graph.id,
        revision: r.graph.revision,
        attemptId: attempt.id,
        turnId: turn.id,
        interruptionId: `${turn.id}:${at}`,
        eligible: record.pending.size === 0 && record.session.state !== "in-terminal",
        at,
      }),
    ];
  });
};

export const recoverSession = Effect.fnUntraced(function* (
  rt: Pick<EngineRuntime["Service"], "store">,
  sessionId: SessionId,
  cause: "restart" | "upgrade",
  at: string
) {
  yield* rt.store.commit({
    commandId: null,
    decide: (model) => {
      const record = model.sessions.get(sessionId);

      if (record === undefined) return Effect.succeed([]);
      const events = decideSession(record, { type: "daemon.recover", cause, at }).events;

      return Effect.succeed(
        events.length === 0 ? [] : [...events, ...interruptionEvents(model, record, at)]
      );
    },
  });
});

/** An upgrade already ended the Turn; re-fold its proof rather than inferring a user interruption. */
export const recoveryCandidates = (model: ReadModel) =>
  [...model.constellations.values()].flatMap((r) =>
    [...r.interruptions.values()].flatMap((proof) => {
      const attempt = r.graph.attempts.find((a) => a.id === proof.attemptId);
      const record = attempt === undefined ? undefined : model.sessions.get(attempt.sessionId);
      const last = record?.turns.at(-1);

      return proof.eligible &&
        attempt?.state === "working" &&
        last?.id === proof.turnId &&
        last.status === "interrupted" &&
        last.endedAt === proof.at
        ? [{ sessionId: attempt.sessionId, interruptionId: proof.interruptionId }]
        : [];
    })
  );
