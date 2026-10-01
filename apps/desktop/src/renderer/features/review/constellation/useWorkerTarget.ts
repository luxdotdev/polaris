import type { SessionId } from "@polaris/protocol";
import { useApp } from "../../../shell/hooks.ts";
import { useWorkerAttempt } from "../../sessions/source.ts";
import type { WorkerTarget } from "./actions.ts";

/** How Review feedback reaches a worker: a send-back while its Claim is in review, else a steer. */
export type FeedbackRoute = "send-back" | "steer";

export interface Worker {
  readonly target: WorkerTarget;
  readonly route: FeedbackRoute;
}

/** The worker this session is, with the Lead's Host its commands go to; null for any other session. */
export const useWorkerTarget = (hostKey: string, sessionId: SessionId | null): Worker | null => {
  // SAFETY: no session has the empty id, so with none open the lookup finds no worker.
  const worker = useWorkerAttempt(hostKey, sessionId ?? ("" as SessionId));
  const hostId = worker?.view.constellation.hostId;

  const leadHostKey = useApp(
    (s) =>
      s.hosts.find((h) => hostId !== undefined && h.status.host?.hostId === hostId)?.key ?? null
  );

  if (worker === null || leadHostKey === null) return null;
  const { attempt } = worker;

  if (attempt.state !== "review" && attempt.state !== "working") return null;

  return {
    target: { leadHostKey, constellationId: worker.view.constellation.id, attempt },
    route: attempt.state === "review" ? "send-back" : "steer",
  };
};
