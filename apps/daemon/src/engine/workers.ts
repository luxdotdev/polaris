/**
 * Constellation workers' sessions, from the graphs: every Attempt's session that isn't a Lead.
 * The Host stream's Snapshot marks them (`AgentSession.worker`) for sessions made before the mark.
 */
import type { AgentSession, ConstellationId, SessionId } from "@polaris/protocol";
import { patchSession } from "../store/model.ts";

interface Graphs {
  readonly constellations: ReadonlyMap<
    string,
    {
      readonly graph: {
        readonly id: ConstellationId;
        readonly leadSessionId: SessionId;
        readonly attempts: ReadonlyArray<{ readonly sessionId: SessionId }>;
      };
    }
  >;
}

/** Each worker session's Constellation; a session that leads any Constellation isn't a worker. */
export const workerSessions = (model: Graphs): ReadonlyMap<SessionId, ConstellationId> => {
  const leads = new Set<SessionId>();
  const workers = new Map<SessionId, ConstellationId>();

  for (const { graph } of model.constellations.values()) {
    leads.add(graph.leadSessionId);

    for (const attempt of graph.attempts) workers.set(attempt.sessionId, graph.id);
  }

  for (const lead of leads) workers.delete(lead);

  return workers;
};

/** The session with its worker mark, when the graphs say it is one and it isn't marked yet. */
export const markedWorker = (
  session: AgentSession,
  workers: ReadonlyMap<SessionId, ConstellationId>
): AgentSession => {
  const constellationId = workers.get(session.id);

  return session.worker != null || constellationId === undefined
    ? session
    : patchSession(session, { worker: { constellationId } });
};
