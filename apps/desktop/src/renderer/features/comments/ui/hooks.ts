/** The open Agent Session's Harness, for "Goes to Claude Code with turn N" and its tile. */
import type { SessionId } from "@polaris/protocol";
import { useApp } from "../../../shell/hooks.ts";
import { sendToWorker, steerWorker } from "../../review/constellation/actions.ts";
import { useWorkerTarget } from "../../review/constellation/useWorkerTarget.ts";
import type { Done } from "../data/actions.ts";
import { useComments } from "../data/store.ts";

export const useSessionHarness = (subjectKey: string): string | null => {
  const session = useComments((s) => s.sessions[subjectKey]);

  return useApp((s) => {
    if (session === undefined) return null;

    for (const model of s.hostModels[session.hostKey]?.sessions.values() ?? []) {
      if (model.session.id === session.sessionId) return model.session.harness;
    }

    return null;
  });
};

/** Feedback to a worker goes through its Constellation: who it's for, how, and the sender. */
export interface WorkerFeedback {
  /** "B1". */
  readonly taskId: string;
  /** "a send-back" while its Claim is in review, else "a steer". */
  readonly how: string;
  readonly send: (subjectKey: string) => Promise<Done>;
}

export const useWorkerFeedback = (subjectKey: string): WorkerFeedback | null => {
  const session = useComments((s) => s.sessions[subjectKey]);

  // SAFETY: the comments store keeps the open subject's session id, from the Host.
  const worker = useWorkerTarget(
    session?.hostKey ?? "",
    (session?.sessionId ?? null) as SessionId | null
  );

  if (worker === null) return null;
  const sender = worker.route === "send-back" ? sendToWorker : steerWorker;

  return {
    taskId: worker.target.attempt.taskId,
    how: worker.route === "send-back" ? "a send-back" : "a steer",
    send: async (key) =>
      (await sender(worker.target, key))
        ? { ok: true }
        : { ok: false, message: "It didn't reach the lead's host; nothing was sent" },
  };
};
