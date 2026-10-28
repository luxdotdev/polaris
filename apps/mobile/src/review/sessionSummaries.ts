/**
 * The Risk Summary Review last opened for each Agent Session, so the thread
 * can follow its findings when it can't key the summary by head itself (a
 * Snapshot's Turns carry no checkpoint commit until ENG-467).
 */
import type { RiskSummaryId, SessionId } from "@polaris/protocol";

const recorded = new Map<string, RiskSummaryId>();

const keyOf = (hostId: string, sessionId: SessionId) => `${hostId}\u0000${sessionId}`;

/** Review calls this when it runs or opens a session's summary. */
export const recordSessionSummary = (
  hostId: string,
  sessionId: SessionId,
  summaryId: RiskSummaryId
) => void recorded.set(keyOf(hostId, sessionId), summaryId);

export const recordedSessionSummary = (
  hostId: string,
  sessionId: SessionId
): RiskSummaryId | null => recorded.get(keyOf(hostId, sessionId)) ?? null;
