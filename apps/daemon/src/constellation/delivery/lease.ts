/**
 * Attempt leases (ENG-1015): a local Attempt that went silent after its Stopped notice, or
 * was interrupted again after its one automatic Continue, settles lost when the lease runs out.
 * Derived from folded events only, so a restart re-arms the same deadline.
 */
import type { Attempt, HostId, SessionId } from "@polaris/protocol";
import { Predicate } from "effect";
import type { ConstellationRecord } from "../../store/constellation.ts";
import type { SessionRecord } from "../../store/model.ts";
import { latestAttempt } from "../projections.ts";
import { workerWait } from "../waiting.ts";
import { pendingInputs } from "./messages.ts";

/** How long a silent local Attempt keeps its lease before it settles lost. */
export const LEASE_MS = 10 * 60_000;

export interface Lease {
  readonly attemptId: Attempt["id"];
  readonly since: number;
  readonly until: number;
  /** The Logbook and digest copy for the lost settle. */
  readonly reason: string;
}

type Sessions = ReadonlyMap<SessionId, SessionRecord>;

const minutes = `${LEASE_MS / 60_000} min silent`;

interface Start {
  readonly at: number;
  /** The graph revision that started it; a later commit from the Attempt is activity. */
  readonly revision: number;
}

/** A notification's id is `${constellationId}:${revision}` (`GraphDecision.notify`). */
const queuedRevision = (id: string) => Number(id.slice(id.lastIndexOf(":") + 1));

/** When the Stopped notice for the Session's last Turn was queued, or null. */
const stoppedSince = (
  record: ConstellationRecord,
  attempt: Attempt,
  session: SessionRecord
): Start | null => {
  const last = session.turns.at(-1);

  if (last?.status !== "completed" || attempt.nudgedAt === null) return null;

  const notice = [...record.notifications.values()].findLast(
    (n) =>
      Predicate.isTagged(n.item, "Stopped") &&
      n.item.attemptId === attempt.id &&
      n.queuedAt >= last.startedAt
  );

  return notice === undefined
    ? null
    : { at: Date.parse(notice.queuedAt), revision: queuedRevision(notice.id) };
};

/** When the second interruption ended the last Turn, after the one automatic Continue was spent. */
const reinterruptedSince = (
  record: ConstellationRecord,
  attempt: Attempt,
  session: SessionRecord
): Start | null => {
  const proof = record.interruptions.get(attempt.id);
  const last = session.turns.at(-1);
  const prefix = `[${JSON.stringify(attempt.id)},`;

  if (
    proof === undefined ||
    last?.id !== proof.turnId ||
    last.status !== "interrupted" ||
    last.endedAt !== proof.at ||
    record.recoveries.has(JSON.stringify([attempt.id, proof.interruptionId])) ||
    ![...record.recoveries].some((key) => key.startsWith(prefix))
  )
    return null;

  return { at: Date.parse(proof.at), revision: proof.revision };
};

/**
 * The Attempt's running lease, or null: only this Host's current working worker holds one,
 * never a stale Attempt (its unpushed commits may exist only on the Offline Host).
 */
export const attemptLease = (
  record: ConstellationRecord,
  attempt: Attempt,
  sessions: Sessions,
  owner: HostId
): Lease | null => {
  const session = sessions.get(attempt.sessionId);

  if (
    session === undefined ||
    record.graph.state !== "running" ||
    record.graph.hostId !== owner ||
    attempt.hostId !== owner ||
    attempt.state !== "working" ||
    attempt.sessionId === record.graph.leadSessionId ||
    record.stale.has(attempt.id) ||
    latestAttempt(record.graph, attempt.taskId)?.id !== attempt.id ||
    pendingInputs(record).some((i) => i.sessionId === attempt.sessionId)
  )
    return null;
  const stopped = stoppedSince(record, attempt, session);
  const start = stopped ?? reinterruptedSince(record, attempt, session);

  // A progress report committed after the lease began is activity from the Attempt.
  if (start === null || (record.progress.get(attempt.id)?.revision ?? 0) > start.revision)
    return null;

  // Waiting on Background Work holds the lease too: it runs out no sooner than the wait.
  const wait = workerWait(record, attempt, session);

  return {
    attemptId: attempt.id,
    since: start.at,
    until: Math.max(start.at + LEASE_MS, wait?.until ?? 0),
    reason: `${minutes} · ${stopped === null ? "interrupted twice" : "stopped notice unanswered"}`,
  };
};

export const leases = (record: ConstellationRecord, sessions: Sessions, owner: HostId) =>
  record.graph.attempts.flatMap((a) => {
    const lease = attemptLease(record, a, sessions, owner);

    return lease === null ? [] : [lease];
  });

/** When the Constellation's next lease runs out; null while none runs. */
export const nextLeaseExpiry = (
  record: ConstellationRecord,
  sessions: Sessions,
  owner: HostId
): number | null => {
  const due = leases(record, sessions, owner).map((l) => l.until);

  return due.length === 0 ? null : Math.min(...due);
};
