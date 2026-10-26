import type { SessionEntry } from "@polaris/sdk";

/** Whether the session can take SendTurn (the SDK does not queue or steer it). */
export const canSendTurn = ({ session, pendingApprovals }: SessionEntry): boolean => {
  if (session.worktreeSetup?.status === "running" || pendingApprovals.length > 0) return false;

  return (
    session.state === "idle" ||
    session.state === "dormant" ||
    session.state === "failed" ||
    session.state === "limited" ||
    session.state === "needs-you"
  );
};
