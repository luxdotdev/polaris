/**
 * Constellation workers' sessions (ENG-586): marked by the Daemon (`AgentSession.worker`) or
 * named by a graph's Attempts. Session lists and notifications leave them to their Lead.
 */
import { isWorkerSession, type SessionWorker } from "@polaris/protocol";

interface GraphLike {
  readonly constellation: {
    readonly leadSessionId: string;
    readonly attempts: ReadonlyArray<{ readonly sessionId: string }>;
  };
}

/** Every Attempt's session but its Constellation's Lead, in any state, archived ones included. */
export const workerSessionsOf = (views: Iterable<GraphLike>): ReadonlySet<string> => {
  const workers = new Set<string>();

  for (const { constellation } of views)
    for (const attempt of constellation.attempts)
      if (attempt.sessionId !== constellation.leadSessionId) workers.add(attempt.sessionId);

  return workers;
};

export const isWorker = (
  session: { readonly id: string; readonly worker?: SessionWorker | null },
  workers: ReadonlySet<string>
) => isWorkerSession(session) || workers.has(session.id);
