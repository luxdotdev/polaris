/**
 * The sidebar's Constellations (DESIGN.md, Constellation (DAG) → Sidebar): each Lead is a
 * session row with its workers nested under it, needs-you first, accepted ones folded into
 * one line; worker sessions leave the plain list. Pure, so it is tested.
 */
import type { Attempt, SessionId, TaskId } from "@polaris/protocol";
import { Match } from "effect";
import { needsYou } from "../../../routes/topBar.ts";
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel, SessionEntry } from "../../../store/hostModel.ts";
import type { Plain } from "../../../store/plain.ts";
import type { ConstellationView } from "../source.ts";

export type WorkerState =
  | "needs-you"
  | "unclaimed"
  | "stale"
  | "review"
  | "working"
  | "sent-back"
  | "failed"
  | "lost"
  | "unverified"
  | "accepted";

export interface WorkerRow {
  readonly taskId: TaskId;
  readonly title: string;
  readonly sessionId: SessionId;
  /** The Host the worker runs on, when this Client knows it. */
  readonly hostKey: string | null;
  /** The worker's session, when its Host's model holds it. */
  readonly entry: SessionEntry | null;
  readonly state: WorkerState;
  readonly attempt: Plain<Attempt>;
  /** False while a remote worker's claimed branch hasn't come back yet. */
  readonly fetched: boolean;
}

export interface LeadGroup {
  readonly key: string;
  readonly view: ConstellationView;
  readonly lead: SessionEntry;
  /** Every worker but the accepted ones, loudest first. */
  readonly workers: ReadonlyArray<WorkerRow>;
  /** Accepted workers, folded into one "A1, A2 done" line. */
  readonly done: ReadonlyArray<WorkerRow>;
  /** Workers that need you, plus the Lead itself when it does. */
  readonly needsYou: number;
}

export type SidebarItem =
  | { readonly kind: "session"; readonly entry: SessionEntry }
  | { readonly kind: "lead"; readonly group: LeadGroup };

/** Where a worker's session lives: its Host's key and entry, or null when no Host here has it. */
export type WorkerLookup = (
  attempt: Plain<Attempt>
) => { readonly hostKey: string; readonly entry: SessionEntry | undefined } | null;

/** Builds a WorkerLookup over every Host this Client knows. */
export const lookupIn = (
  hosts: ReadonlyArray<HostView>,
  models: Readonly<Record<string, HostModel>>
): WorkerLookup => {
  const keyOf = new Map<string | undefined, string>(
    hosts.map((h) => [h.status.host?.hostId, h.key])
  );

  return (attempt) => {
    const hostKey = keyOf.get(attempt.hostId);

    return hostKey === undefined
      ? null
      : { hostKey, entry: models[hostKey]?.sessions.get(attempt.sessionId) };
  };
};

const ATTENTION: ReadonlySet<WorkerState> = new Set(["needs-you", "unclaimed", "stale"]);

const RANK: Readonly<Record<WorkerState, number>> = {
  "needs-you": 0,
  unclaimed: 0,
  stale: 0,
  review: 1,
  working: 2,
  "sent-back": 3,
  failed: 3,
  lost: 3,
  unverified: 3,
  accepted: 4,
};

export const needsAttention = (state: WorkerState) => ATTENTION.has(state);

/** A working Attempt whose session ended its Turn without a Claim (after its one nudge). */
const stoppedWithoutClaim = (entry: SessionEntry | null) =>
  entry !== null && (entry.session.state === "idle" || entry.session.state === "dormant");

const workingState = (entry: SessionEntry | null, stale: boolean): WorkerState => {
  if (entry !== null && needsYou(entry)) return "needs-you";

  if (stale) return "stale";

  return stoppedWithoutClaim(entry) ? "unclaimed" : "working";
};

export const workerState = (
  attempt: Plain<Attempt>,
  entry: SessionEntry | null,
  stale: boolean
): WorkerState =>
  Match.value(attempt.state).pipe(
    Match.when("working", () => workingState(entry, stale)),
    Match.when("review", (): WorkerState => (stale ? "stale" : "review")),
    Match.when("accepted", (): WorkerState => "accepted"),
    Match.when("rejected", (): WorkerState => "sent-back"),
    Match.when("failed", (): WorkerState => "failed"),
    Match.when("lost", (): WorkerState => "lost"),
    Match.when("settled_unverified", (): WorkerState => "unverified"),
    Match.exhaustive
  );

/** One row per Task a worker has tried (its latest Attempt); Gates are the Lead's own. */
export const workerRows = (view: ConstellationView, lookup: WorkerLookup): Array<WorkerRow> => {
  const { constellation, projections } = view;
  const stale = new Set(projections.filter((p) => p.stale).map((p) => p.taskId));
  const unfetched = new Set(projections.filter((p) => !p.branchFetched).map((p) => p.taskId));
  const order = new Map(constellation.tasks.map((t, i) => [t.id, i]));

  const rows = constellation.tasks.flatMap((task): Array<WorkerRow> => {
    const attempt = constellation.attempts.findLast((a) => a.taskId === task.id);

    if (task.canceled || task.kind === "gate" || attempt === undefined) return [];

    if (attempt.sessionId === constellation.leadSessionId) return [];
    const found = lookup(attempt);
    const entry = found?.entry ?? null;

    return [
      {
        taskId: task.id,
        title: task.title,
        sessionId: attempt.sessionId,
        hostKey: found?.hostKey ?? null,
        entry,
        state: workerState(attempt, entry, stale.has(task.id)),
        attempt,
        fetched: !unfetched.has(task.id),
      },
    ];
  });

  return rows.sort(
    (a, b) =>
      RANK[a.state] - RANK[b.state] || (order.get(a.taskId) ?? 0) - (order.get(b.taskId) ?? 0)
  );
};

export const leadKey = (hostKey: string, leadSessionId: string) =>
  `lead:${hostKey}:${leadSessionId}`;

interface GroupInput {
  readonly hostKey: string;
  /** This Workspace's active sessions, in sidebar order. */
  readonly entries: ReadonlyArray<SessionEntry>;
  /** The Host's Constellations. */
  readonly views: ReadonlyArray<ConstellationView>;
  readonly lookup: WorkerLookup;
}

/** The Workspace's session list with each Lead's workers pulled under it. */
export const sidebarItems = ({ hostKey, entries, views, lookup }: GroupInput) => {
  const live = views.filter((v) => v.constellation.state !== "archived");

  const byLead = new Map<string, ConstellationView>(
    live.map((v) => [v.constellation.leadSessionId, v])
  );

  const groups = new Map<string, LeadGroup>();

  for (const entry of entries) {
    const view = byLead.get(entry.session.id);

    if (view === undefined) continue;
    const rows = workerRows(view, lookup);
    const workers = rows.filter((r) => r.state !== "accepted");

    groups.set(entry.session.id, {
      key: leadKey(hostKey, entry.session.id),
      view,
      lead: entry,
      workers,
      done: rows.filter((r) => r.state === "accepted"),
      needsYou: workers.filter((r) => needsAttention(r.state)).length + (needsYou(entry) ? 1 : 0),
    });
  }

  const nested = new Set(
    [...groups.values()].flatMap((g): Array<string> =>
      [...g.workers, ...g.done].map((r) => r.sessionId)
    )
  );

  const items = entries.flatMap((entry): Array<SidebarItem> => {
    const group = groups.get(entry.session.id);

    if (group !== undefined) return [{ kind: "lead", group }];

    return nested.has(entry.session.id) ? [] : [{ kind: "session", entry }];
  });

  return { items, constellations: groups.size };
};

/** "Lead · 7 workers", or folded "3 workers · 1 needs you" (the needs-you part is tinted). */
export const leadLine = (group: LeadGroup) => {
  const count = group.workers.length + group.done.length;

  return {
    workers: `${count} ${count === 1 ? "worker" : "workers"}`,
    needsYou: group.needsYou === 0 ? null : `${group.needsYou} needs you`,
  };
};

/** "A1, A2 done"; past four ids, "A1, A2, A3 and 3 more done". */
export const doneLine = (done: ReadonlyArray<WorkerRow>) => {
  const ids: ReadonlyArray<string> = done.map((r) => r.taskId);

  return ids.length <= 4
    ? `${ids.join(", ")} done`
    : `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more done`;
};
