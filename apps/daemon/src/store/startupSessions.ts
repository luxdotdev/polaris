import {
  DomainEvent,
  type Constellation,
  type ConstellationId,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import type { ReadModel } from "./model.ts";

/** Only internal startup waiters receive graph lifecycle changes on the affected Session. */
export const startupSessions = (event: DomainEvent, model: ReadModel): ReadonlyArray<SessionId> => {
  if (
    !DomainEvent.isAnyOf([
      "AttemptStarted",
      "AttemptBlocked",
      "AttemptUnblocked",
      "AttemptSettled",
      "AttemptClaimed",
      "AttemptAccepted",
      "AttemptRejected",
      "AttemptStale",
      "AttemptFresh",
      "TaskCanceled",
      "ConstellationStateChanged",
    ])(event)
  )
    return [];
  const graph = model.constellations.get(event.constellationId)?.graph;

  if (graph === undefined) return [];

  if ("attempt" in event) return [event.attempt.sessionId];

  if ("attemptId" in event)
    return graph.attempts.flatMap((a) => (a.id === event.attemptId ? [a.sessionId] : []));

  return graph.attempts.map((a) => a.sessionId);
};

/** Attempt bindings only append, so this index is derived once and updated after durable commits. */
export class StartupGraphIndex {
  readonly queuedTurns = new Map<SessionId, TurnId>();
  readonly sessions = new Map<SessionId, Set<ConstellationId>>();
  constructor(model: ReadModel) {
    for (const record of model.constellations.values())
      for (const attempt of record.graph.attempts) this.add(attempt.sessionId, record.graph.id);
  }
  add(sessionId: SessionId, graphId: ConstellationId) {
    const graphs = this.sessions.get(sessionId) ?? new Set<ConstellationId>();
    graphs.add(graphId);
    this.sessions.set(sessionId, graphs);
  }
  committed(event: DomainEvent) {
    if (
      DomainEvent.isAnyOf(["TurnEnded"])(event) &&
      this.queuedTurns.get(event.turn.sessionId) === event.turn.id
    )
      this.queuedTurns.delete(event.turn.sessionId);

    if (DomainEvent.isAnyOf(["AttemptStarted"])(event))
      this.add(event.attempt.sessionId, event.constellationId);
  }
  graphs(model: ReadModel, sessionId: SessionId): ReadonlyArray<Constellation> {
    return [...(this.sessions.get(sessionId) ?? [])].flatMap(
      (id) => model.constellations.get(id)?.graph ?? []
    );
  }
}
