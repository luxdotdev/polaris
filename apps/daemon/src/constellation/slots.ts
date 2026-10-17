import type { Attempt, ConstellationId, HostId, ResourceLease, SessionId } from "@polaris/protocol";
import { WORKERS_RESOURCE, type ResourcesModel } from "../resources/model.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import type { SessionRecord } from "../store/model.ts";

/** The Host facts a Lead needs to tell a stuck worker from a queued one; all folded state. */
export interface HostSlots {
  readonly hostId: HostId;
  readonly resources: ResourcesModel;
  readonly constellations: ReadonlyMap<ConstellationId, ConstellationRecord>;
  readonly sessions: ReadonlyMap<SessionId, SessionRecord>;
  readonly now: number;
}

export type WorkerSlot =
  | { readonly kind: "holding"; readonly since: string }
  | { readonly kind: "waiting"; readonly position: number; readonly of: number }
  | { readonly kind: "none" }
  | { readonly kind: "remote" };

export type WorkerTurn =
  | { readonly kind: "running" }
  | { readonly kind: "none" }
  | { readonly kind: "ended"; readonly status: string; readonly endedAt: string | null };

export interface WorkerFacts {
  readonly setup: "running" | "completed" | "failed" | null;
  readonly slot: WorkerSlot;
  readonly turn: WorkerTurn;
}

const workerLeases = (resources: ResourcesModel): ReadonlyArray<ResourceLease> =>
  [...resources.leases.values()].filter((lease) => lease.resource === WORKERS_RESOURCE);

const workerWaiters = (resources: ResourcesModel) =>
  [...resources.waiting.values()].filter((waiter) => waiter.resource === WORKERS_RESOURCE);

const slotOf = (attempt: Attempt, host: HostSlots | undefined): WorkerSlot => {
  if (host === undefined || attempt.hostId !== host.hostId) return { kind: "remote" };

  const lease = workerLeases(host.resources).find(
    (l) => l.attemptId === attempt.id || l.sessionId === attempt.sessionId
  );

  if (lease !== undefined) return { kind: "holding", since: lease.acquiredAt };
  const waiters = workerWaiters(host.resources);
  const index = waiters.findIndex((w) => w.sessionId === attempt.sessionId);

  return index === -1
    ? { kind: "none" }
    : { kind: "waiting", position: index + 1, of: waiters.length };
};

const turnOf = (attempt: Attempt, session: SessionRecord): WorkerTurn => {
  if (session.turns.some((t) => t.status === "working")) return { kind: "running" };
  const last = session.turns.findLast((t) => t.startedAt >= attempt.startedAt);

  return last === undefined
    ? { kind: "none" }
    : { kind: "ended", status: last.status, endedAt: last.endedAt };
};

/** Setup, slot and Turn for one working Attempt, read from the Session and Host folds. */
export const workerFacts = (
  constellationId: ConstellationId,
  attempt: Attempt,
  session: SessionRecord,
  host?: HostSlots
): WorkerFacts => {
  const run = session.session.worktreeSetup;

  const setup =
    run != null && run.constellationId === constellationId && run.taskId === attempt.taskId
      ? run.status
      : null;

  return { setup, slot: slotOf(attempt, host), turn: turnOf(attempt, session) };
};

/** "40s", "12m", "1h05m": enough to spot an idle holder, short enough for every status. */
export const age = (since: string, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m`;

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
};

const turnText = (turn: WorkerTurn): string => {
  switch (turn.kind) {
    case "running":
      return "Turn running";
    case "none":
      return "no Turn yet";
    case "ended":
      return `idle, last Turn ${turn.status}${turn.endedAt === null ? "" : ` at ${turn.endedAt}`}`;
  }
};

const slotText = (slot: WorkerSlot, now: number): string | null => {
  switch (slot.kind) {
    case "holding":
      return `slot held ${age(slot.since, now)}`;
    case "waiting":
      return `waiting for a slot (${slot.position} of ${slot.of})`;
    case "none":
      return "no slot";
    case "remote":
      return null;
  }
};

export const workerLine = (facts: WorkerFacts, now: number): string =>
  [
    `Worker: ${turnText(facts.turn)}`,
    facts.setup === null ? null : `setup ${facts.setup === "completed" ? "done" : facts.setup}`,
    slotText(facts.slot, now),
  ]
    .filter((part) => part !== null)
    .join(" · ");

interface Owner {
  readonly record: ConstellationRecord;
  readonly attempt: Attempt;
}

const ownerOf = (
  host: HostSlots,
  attemptId: Attempt["id"] | null | undefined,
  sessionId: SessionId | null | undefined
): Owner | undefined => {
  const owners = [...host.constellations.values()].flatMap((record) =>
    record.graph.attempts
      .filter((a) => a.id === attemptId || a.sessionId === sessionId)
      .map((attempt) => ({ record, attempt }))
  );

  return (
    owners.find((o) => o.attempt.id === attemptId) ??
    owners.findLast((o) => o.attempt.endedAt == null) ??
    owners.at(-1)
  );
};

const ownerName = (
  owner: Owner | undefined,
  current: ConstellationId,
  sessionId: SessionId | null | undefined
) => {
  if (owner === undefined) return `session ${sessionId ?? "unknown"}`;

  const name =
    owner.record.graph.id === current
      ? owner.attempt.taskId
      : `${owner.record.graph.name}/${owner.attempt.taskId}`;

  // A slot held for an ended Attempt is the idle holder a Lead most needs to see.
  return owner.attempt.endedAt == null ? name : `${name} (${owner.attempt.state})`;
};

const turnRunning = (host: HostSlots, sessionId: SessionId | null | undefined) =>
  sessionId != null &&
  host.sessions.get(sessionId)?.turns.some((t) => t.status === "working") === true;

/**
 * One line for the Host's worker slots: each holder (this Constellation's by Task id, others as
 * name/Task), how long it has held, whether a Turn runs, then the FIFO waiters.
 */
export const slotLine = (host: HostSlots, current: ConstellationId): string | null => {
  const leases = workerLeases(host.resources);
  const waiters = workerWaiters(host.resources);

  if (leases.length === 0 && waiters.length === 0) return null;
  const cap = host.resources.resources.get(WORKERS_RESOURCE)?.capacity;

  const held = leases.map(
    (lease) =>
      `${ownerName(ownerOf(host, lease.attemptId, lease.sessionId), current, lease.sessionId)} ${age(lease.acquiredAt, host.now)} ${turnRunning(host, lease.sessionId) ? "running" : "no Turn"}`
  );

  const queued = waiters.map((w) =>
    ownerName(ownerOf(host, w.attemptId, w.sessionId), current, w.sessionId)
  );

  return [
    `Host slots: ${leases.length}${cap === undefined ? "" : `/${cap}`} held`,
    ...held,
    ...(queued.length === 0 ? [] : [`waiting: ${queued.join(", ")}`]),
  ].join(" · ");
};
