/**
 * How long a held Claim waits for a remote worker's head (ADR 0119). The deadline counts from
 * the durable `InspectionStarted`, so a restarted Daemon keeps it, and it is one of the times
 * the Constellation's single worker wake sleeps to: no Inspection has a timer of its own.
 */
import { type Attempt, type HostId, type Inspection, inspecting } from "@polaris/protocol";
import type { ConstellationRecord } from "../../store/constellation.ts";
import type { ReadModel } from "../../store/model.ts";

export const REMOTE_HEAD_WAIT_MS = 5 * 60_000;

export const remoteHeadDeadline = (inspection: Inspection) =>
  Date.parse(inspection.startedAt) + REMOTE_HEAD_WAIT_MS;

/** A held Claim of a worker on another Host whose Inspector has not had its first Turn. */
const awaitingHead = (attempt: Attempt, owner: HostId, sessions: ReadModel["sessions"]) =>
  attempt.inspection != null &&
  inspecting(attempt) &&
  attempt.hostId !== owner &&
  (sessions.get(attempt.inspection.sessionId)?.turns.length ?? 0) === 0;

/** When the next wait for a remote head runs out; null when none is still ahead. */
export const nextRemoteHeadDeadline = (
  record: ConstellationRecord,
  sessions: ReadModel["sessions"],
  owner: HostId,
  now: number
): number | null => {
  const due = record.graph.attempts
    .flatMap((a) =>
      a.inspection != null && awaitingHead(a, owner, sessions)
        ? [remoteHeadDeadline(a.inspection)]
        : []
    )
    .filter((at) => at > now);

  return due.length === 0 ? null : Math.min(...due);
};
