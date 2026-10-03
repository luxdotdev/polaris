import type { Attempt, SessionState } from "@polaris/protocol";

interface NudgedAttempt {
  readonly state: Attempt["state"];
  readonly nudgedAt?: string | null | undefined;
}

interface WorkerSession {
  readonly state: SessionState;
  readonly updatedAt: string;
}

const ENDED: ReadonlySet<SessionState> = new Set(["idle", "dormant"]);

/**
 * Stopped without claiming (DESIGN.md, Silent ends): nudged once (`nudgedAt`), then the
 * worker's session ended a Turn again, so it went quiet after the nudge, not before it.
 */
export const stoppedWithoutClaiming = (attempt: NudgedAttempt, session: WorkerSession | null) =>
  attempt.state === "working" &&
  attempt.nudgedAt != null &&
  session !== null &&
  ENDED.has(session.state) &&
  Date.parse(session.updatedAt) > Date.parse(attempt.nudgedAt);
