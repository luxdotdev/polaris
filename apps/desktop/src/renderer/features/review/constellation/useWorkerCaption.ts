import type { SessionId } from "@polaris/protocol";
import { useApp } from "../../../shell/hooks.ts";
import { slotWaitOf } from "../../../store/hostResources.ts";
import { useWorkerAttempt } from "../../sessions/source.ts";
import { workerCaption } from "./model.ts";

/** "worker of {lead} · claim in review at {head}" for a worker session; null otherwise. */
export const useWorkerCaption = (hostKey: string, sessionId: SessionId): string | null => {
  const worker = useWorkerAttempt(hostKey, sessionId);
  const constellation = worker?.view.constellation;

  const leadTitle = useApp((s) => {
    if (constellation === undefined) return null;
    const key = s.hosts.find((h) => h.status.host?.hostId === constellation.hostId)?.key;

    return key === undefined
      ? null
      : (s.hostModels[key]?.sessions.get(constellation.leadSessionId)?.session.title ?? null);
  });

  const slotHost = useApp((s) => {
    if (worker === null) return null;
    const host = s.hosts.find((h) => h.status.host?.hostId === worker.attempt.hostId);
    const model = host === undefined ? undefined : s.hostModels[host.key];

    return model === undefined ||
      host === undefined ||
      slotWaitOf(model.resources, worker.attempt) === null
      ? null
      : host.label;
  });

  if (worker === null || constellation === undefined) return null;

  return workerCaption(worker.attempt, leadTitle || `${constellation.name} lead`, slotHost);
};
