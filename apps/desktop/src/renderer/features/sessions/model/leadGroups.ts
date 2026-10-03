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
import { slotWaitOf } from "../../../store/hostResources.ts";
import type { Plain } from "../../../store/plain.ts";
import {
  currentSetup,
  type SetupFact,
  setupSources,
  setupsOf,
} from "../../constellation/model/setup.ts";
import { stoppedWithoutClaiming } from "../../constellation/model/stopped.ts";
import type { ConstellationView } from "../source.ts";

export type WorkerState =
  | "needs-you"
  | "unclaimed"
  | "handed-up"
  | "stale"
  | "review"
  | "waiting-slot"
  | "working"
  | "sent-back"
  | "failed"
  | "lost"
  | "unverified"
  | "accepted"
  | "setting-up"
  | "setup-failed";

export interface WorkerRow {
  readonly kind: "attempt";
  readonly taskId: TaskId;
  readonly title: string;
  /** The Task's group ("desktop"), or null on the trunk. */
  readonly group: string | null;
  readonly sessionId: SessionId;
  /** The Host the worker runs on, when this Client knows it. */
  readonly hostKey: string | null;
  /** The worker's session, when its Host's model holds it. */
  readonly entry: SessionEntry | null;
  readonly state: WorkerState;
  readonly attempt: Plain<Attempt>;
  /** False while a remote worker's claimed branch hasn't come back yet. */
  readonly fetched: boolean;
  /** Since when it has waited for a worker slot on its Host; null when it isn't. */
  readonly slotSince: string | null;
}

/**
 * A worker whose worktree setup runs or failed before its first Attempt (C1-G2): it nests
 * under its Lead like any worker, reading "setting up" or "setup failed", never its Session State.
 */
export interface SetupRow {
  readonly kind: "setup";
  readonly taskId: TaskId;
  readonly title: string;
  readonly group: string | null;
  readonly sessionId: SessionId;
  readonly hostKey: string;
  readonly entry: SessionEntry | null;
  readonly state: "setting-up" | "setup-failed";
  readonly setup: SetupFact;
}

/** A row under a Lead in the sidebar. */
export type LeadWorker = WorkerRow | SetupRow;

export interface LeadGroup {
  readonly key: string;
  readonly view: ConstellationView;
  readonly lead: SessionEntry;
  /** Every worker but the accepted ones, loudest first. */
  readonly workers: ReadonlyArray<LeadWorker>;
  /** Accepted workers, folded into one "A1, A2 done" line. */
  readonly done: ReadonlyArray<WorkerRow>;
  /** Workers that need you, plus the Lead itself when it does. */
  readonly needsYou: number;
}

export type SidebarItem =
  | { readonly kind: "session"; readonly entry: SessionEntry }
  | { readonly kind: "lead"; readonly group: LeadGroup };

/** Where a worker's session lives: its Host's key and entry, or null when no Host here has it. */
export type WorkerLookup = (attempt: Plain<Attempt>) => {
  readonly hostKey: string;
  readonly entry: SessionEntry | undefined;
  /** Since when the Attempt has waited for a slot on that Host (its `__workers` queue). */
  readonly slotSince: string | null;
} | null;

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

    const model = hostKey === undefined ? undefined : models[hostKey];

    return hostKey === undefined
      ? null
      : {
          hostKey,
          entry: model?.sessions.get(attempt.sessionId),
          slotSince: model === undefined ? null : slotWaitOf(model.resources, attempt),
        };
  };
};

const ATTENTION: ReadonlySet<WorkerState> = new Set([
  "needs-you",
  "setup-failed",
  "unclaimed",
  "stale",
  "handed-up",
]);

const RANK: Readonly<Record<WorkerState, number>> = {
  "needs-you": 0,
  unclaimed: 0,
  stale: 0,
  "handed-up": 0,
  "setup-failed": 0,
  review: 1,
  "setting-up": 2,
  working: 2,
  "waiting-slot": 2,
  "sent-back": 3,
  failed: 3,
  lost: 3,
  unverified: 3,
  accepted: 4,
};

export const needsAttention = (state: WorkerState) => ATTENTION.has(state);

const workingState = (
  attempt: Plain<Attempt>,
  entry: SessionEntry | null,
  stale: boolean,
  slotSince: string | null
): WorkerState => {
  if (entry !== null && needsYou(entry)) return "needs-you";

  if (stale) return "stale";

  if (slotSince !== null) return "waiting-slot";

  return stoppedWithoutClaiming(attempt, entry?.session ?? null) ? "unclaimed" : "working";
};

/** In review: the Lead's to decide, unless it handed the Claim up to the user. */
const reviewState = (attempt: Plain<Attempt>, stale: boolean): WorkerState => {
  if (stale) return "stale";

  return attempt.handedUpAt != null && attempt.approvedByUserAt == null ? "handed-up" : "review";
};

export const workerState = (
  attempt: Plain<Attempt>,
  entry: SessionEntry | null,
  stale: boolean,
  slotSince: string | null = null
): WorkerState =>
  Match.value(attempt.state).pipe(
    Match.when("working", () => workingState(attempt, entry, stale, slotSince)),
    Match.when("review", () => reviewState(attempt, stale)),
    Match.when("accepted", (): WorkerState => "accepted"),
    Match.when("rejected", (): WorkerState => "sent-back"),
    Match.when("failed", (): WorkerState => "failed"),
    Match.when("lost", (): WorkerState => "lost"),
    Match.when("settled_unverified", (): WorkerState => "unverified"),
    Match.exhaustive
  );

const groupName = (group: string | null | undefined) =>
  group == null || group === "" ? null : group;

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
        kind: "attempt",
        taskId: task.id,
        title: task.title,
        group: groupName(task.group),
        sessionId: attempt.sessionId,
        hostKey: found?.hostKey ?? null,
        entry,
        state: workerState(attempt, entry, stale.has(task.id), found?.slotSince ?? null),
        attempt,
        fetched: !unfetched.has(task.id),
        slotSince: found?.slotSince ?? null,
      },
    ];
  });

  return rows.sort(byRank(order));
};

const byRank =
  (order: ReadonlyMap<string, number>) =>
  (a: Pick<LeadWorker, "state" | "taskId">, b: Pick<LeadWorker, "state" | "taskId">) =>
    RANK[a.state] - RANK[b.state] || (order.get(a.taskId) ?? 0) - (order.get(b.taskId) ?? 0);

/** A Constellation's setup rows, from every Host's Session summaries. */
export type SetupLookup = (view: ConstellationView) => ReadonlyArray<SetupRow>;

/** Tasks whose current setup (running, or failed and newer than any Attempt) has no Attempt after it. */
export const setupLookupIn =
  (hosts: ReadonlyArray<HostView>, models: Readonly<Record<string, HostModel>>): SetupLookup =>
  ({ constellation }) => {
    const facts = setupsOf(setupSources(hosts, models), constellation.id, constellation.hostId);

    if (facts.size === 0) return [];

    return constellation.tasks.flatMap((task): Array<SetupRow> => {
      const latest = constellation.attempts.findLast((a) => a.taskId === task.id) ?? null;
      const setup = currentSetup(facts.get(task.id) ?? null, latest);

      if (setup === null || task.canceled || task.kind === "gate") return [];

      return [
        {
          kind: "setup",
          taskId: task.id,
          title: task.title,
          group: groupName(task.group),
          sessionId: setup.sessionId,
          hostKey: setup.hostKey,
          entry: models[setup.hostKey]?.sessions.get(setup.sessionId) ?? null,
          state: setup.failed ? "setup-failed" : "setting-up",
          setup,
        },
      ];
    });
  };

/** Attempt rows and setup rows together: a current setup stands in for its Task's older Attempt. */
export const leadWorkers = (
  view: ConstellationView,
  lookup: WorkerLookup,
  setups: SetupLookup
): Array<LeadWorker> => {
  const setupRows = setups(view);
  const replaced = new Set(setupRows.map((r) => r.taskId));
  const order = new Map(view.constellation.tasks.map((t, i) => [t.id, i]));

  return [...workerRows(view, lookup).filter((r) => !replaced.has(r.taskId)), ...setupRows].sort(
    byRank(order)
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
  readonly setups: SetupLookup;
}

/** The Workspace's session list with each Lead's workers pulled under it. */
export const sidebarItems = ({ hostKey, entries, views, lookup, setups }: GroupInput) => {
  const live = views.filter((v) => v.constellation.state !== "archived");

  const byLead = new Map<string, ConstellationView>(
    live.map((v) => [v.constellation.leadSessionId, v])
  );

  const groups = new Map<string, LeadGroup>();

  for (const entry of entries) {
    const view = byLead.get(entry.session.id);

    if (view === undefined) continue;
    const rows = leadWorkers(view, lookup, setups);
    const workers = rows.filter((r) => r.state !== "accepted");

    groups.set(entry.session.id, {
      key: leadKey(hostKey, entry.session.id),
      view,
      lead: entry,
      workers,
      done: rows.filter((r): r is WorkerRow => r.kind === "attempt" && r.state === "accepted"),
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

/** A Task group's workers under a Lead; the trunk's (ungrouped) has no label. */
export interface WorkerSection {
  readonly key: string;
  readonly label: string | null;
  readonly rows: ReadonlyArray<LeadWorker>;
  readonly needsYou: number;
}

/**
 * Workers by `task.group`, as the tab groups them: ungrouped ones first, then each group in
 * order of its loudest worker, so whatever needs you leads. Rows keep their order.
 */
export const workerSections = (rows: ReadonlyArray<LeadWorker>): Array<WorkerSection> => {
  const byGroup = new Map<string | null, Array<LeadWorker>>([[null, []]]);

  for (const row of rows) byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);

  return [...byGroup].flatMap(([label, members]): Array<WorkerSection> =>
    members.length === 0
      ? []
      : [
          {
            key: label ?? "",
            label,
            rows: members,
            needsYou: members.filter((r) => needsAttention(r.state)).length,
          },
        ]
  );
};
