/**
 * Constellation items in the Needs You inbox (spec §5; DESIGN.md, Constellation (DAG) → Needs
 * you; Paper C5): grouped under each Lead, in the decided priority order. Pure, so it is tested.
 */
import type { ApprovalRequest, ConstellationQuestion, TaskId } from "@polaris/protocol";
import { Predicate } from "effect";
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel, SessionEntry } from "../../../store/hostModel.ts";
import type { Plain } from "../../../store/plain.ts";
import { lookupIn, workerRows, type WorkerRow } from "../../sessions/model/leadGroups.ts";
import {
  type ConstellationView,
  currentSetup,
  type SetupFact,
  setupSources,
  setupsOf,
} from "../../sessions/source.ts";
import { needsYou } from "../../../routes/topBar.ts";
import { type Inbox, inboxKey } from "./inbox.ts";

/** The decided order (spec §5), plus a paused Constellation's Claims, which only then reach here. */
export const PRIORITY = [
  "worker-approval",
  "question",
  "lead",
  "claim",
  "unclaimed",
  "setup",
  "stale",
  "worker-context",
  "lead-context",
] as const;

export type ItemKind = (typeof PRIORITY)[number];

/** A worker's or the Lead's context at or past this share asks for a fresh start or a handover. */
export const CONTEXT_LIMIT = 0.85;

export interface ConstellationItem {
  readonly key: string;
  readonly kind: ItemKind;
  /** The session it is about, on the Host that runs it; null when no Host here has it. */
  readonly hostKey: string | null;
  readonly entry: SessionEntry | null;
  /** The worker's Task, or null for the Lead. */
  readonly taskId: TaskId | null;
  /** When it started waiting on you. */
  readonly since: string;
  /** An approval (or a Harness question) the session is blocked on. */
  readonly request?: Plain<ApprovalRequest>;
  readonly question?: Plain<ConstellationQuestion>;
  /** The share of the context window used, for the context items. */
  readonly context?: number;
  /** For workers: their row, so actions know the Attempt. */
  readonly worker?: WorkerRow;
  /** A failed worktree setup: it has no Attempt, so it has no worker row. */
  readonly setup?: SetupFact;
}

export interface ConstellationGroup {
  readonly key: string;
  readonly view: ConstellationView;
  readonly leadHostKey: string;
  readonly lead: SessionEntry | null;
  readonly items: ReadonlyArray<ConstellationItem>;
}

export interface ConstellationInbox {
  readonly groups: ReadonlyArray<ConstellationGroup>;
  /** Sessions shown here, so the plain inbox leaves them out (`inboxKey`). */
  readonly sessions: ReadonlySet<string>;
}

export interface ConstellationInput {
  readonly hosts: ReadonlyArray<HostView>;
  readonly models: Readonly<Record<string, HostModel>>;
  readonly views: Readonly<Record<string, ReadonlyArray<ConstellationView>>>;
}

const RANK = new Map<ItemKind, number>(PRIORITY.map((k, i) => [k, i]));

const rank = (item: ConstellationItem) => RANK.get(item.kind) ?? PRIORITY.length;

export const contextShare = (entry: SessionEntry | null): number | null => {
  const usage = entry?.session.contextUsage ?? null;

  if (usage === null || usage.windowTokens === null || usage.windowTokens <= 0) return null;

  return usage.usedTokens / usage.windowTokens;
};

const requestItems = (
  base: Omit<ConstellationItem, "key" | "kind" | "since">,
  key: string,
  lead: boolean
): Array<ConstellationItem> => {
  const pending = [...(base.entry?.pendingApprovals ?? [])].sort((a, b) =>
    a.openedAt.localeCompare(b.openedAt)
  );

  const first = pending[0];

  if (first === undefined) return [];

  const kind: ItemKind = lead ? "lead" : first.kind === "question" ? "question" : "worker-approval";

  return [{ ...base, key: `${key}\u0000${first.id}`, kind, since: first.openedAt, request: first }];
};

const workerItems = (row: WorkerRow, groupKey: string): Array<ConstellationItem> => {
  const key = `${groupKey}\u0000${row.taskId}`;
  const base = { hostKey: row.hostKey, entry: row.entry, taskId: row.taskId, worker: row };
  const items = requestItems(base, key, false);
  const updated = row.entry?.session.updatedAt ?? row.attempt.startedAt;

  if (row.state === "unclaimed")
    items.push({ ...base, key: `${key}\u0000unclaimed`, kind: "unclaimed", since: updated });

  if (row.state === "stale")
    items.push({ ...base, key: `${key}\u0000stale`, kind: "stale", since: updated });

  const context = contextShare(row.entry);

  if (row.state === "working" && context !== null && context >= CONTEXT_LIMIT)
    items.push({
      ...base,
      key: `${key}\u0000context`,
      kind: "worker-context",
      since: updated,
      context,
    });

  return items;
};

const questionItems = (
  view: ConstellationView,
  rows: ReadonlyArray<WorkerRow>,
  groupKey: string
): Array<ConstellationItem> =>
  view.constellation.pendingNotifications.flatMap((n): Array<ConstellationItem> => {
    const { item } = n;

    if (!Predicate.isTagged(item, "Question") || item.question.to !== "user") return [];
    const { attemptId, question } = item;
    const row = rows.find((r) => r.attempt.id === attemptId);

    const shown: ConstellationItem = {
      key: `${groupKey}\u0000q\u0000${question.id}`,
      kind: "question",
      hostKey: row?.hostKey ?? null,
      entry: row?.entry ?? null,
      taskId: row?.taskId ?? null,
      since: n.queuedAt,
      question,
    };

    return [row === undefined ? shown : { ...shown, worker: row }];
  });

const leadItems = (
  hostKey: string,
  lead: SessionEntry | null,
  groupKey: string
): Array<ConstellationItem> => {
  const base = { hostKey, entry: lead, taskId: null };
  const items = requestItems(base, `${groupKey}\u0000lead`, true);
  const context = contextShare(lead);

  if (lead !== null && context !== null && context >= CONTEXT_LIMIT)
    items.push({
      ...base,
      key: `${groupKey}\u0000lead-context`,
      kind: "lead-context",
      since: lead.session.updatedAt,
      context,
    });

  return items;
};

/** Claims the user decides: handed up by the Lead, or every one while the Constellation is paused. */
const claimItems = (rows: ReadonlyArray<WorkerRow>, groupKey: string, paused: boolean) =>
  rows.flatMap((row): Array<ConstellationItem> =>
    row.state === "handed-up" || (paused && row.state === "review")
      ? [
          {
            key: `${groupKey}\u0000${row.taskId}\u0000claim`,
            kind: "claim",
            hostKey: row.hostKey,
            entry: row.entry,
            taskId: row.taskId,
            since: row.attempt.endedAt ?? row.attempt.startedAt,
            worker: row,
          },
        ]
      : []
  );

const ordered = (items: ReadonlyArray<ConstellationItem>) =>
  [...items].sort((a, b) => rank(a) - rank(b) || a.since.localeCompare(b.since));

/** Tasks whose worktree setup failed and is still current (no newer Attempt), on any Host. */
const setupItems = (
  view: ConstellationView,
  input: Pick<ConstellationInput, "hosts" | "models">,
  groupKey: string
): Array<ConstellationItem> => {
  const c = view.constellation;
  const setups = setupsOf(setupSources(input.hosts, input.models), c.id, c.hostId);

  return [...setups.values()].flatMap((fact): Array<ConstellationItem> => {
    const latest = c.attempts.findLast((a) => a.taskId === fact.run.taskId) ?? null;

    if (!c.tasks.some((t) => t.id === fact.run.taskId) || currentSetup(fact, latest) === null)
      return [];

    if (!fact.failed) return [];

    return [
      {
        key: `${groupKey}\u0000${fact.run.taskId}\u0000setup`,
        kind: "setup",
        hostKey: fact.hostKey,
        entry: input.models[fact.hostKey]?.sessions.get(fact.sessionId) ?? null,
        taskId: fact.run.taskId,
        since: fact.run.endedAt ?? fact.run.startedAt,
        setup: fact,
      },
    ];
  });
};

interface GroupInput {
  readonly hostKey: string;
  readonly view: ConstellationView;
  readonly hosts: ConstellationInput["hosts"];
  readonly models: ConstellationInput["models"];
  readonly lookup: ReturnType<typeof lookupIn>;
}

const LIVE = new Set(["planning", "running", "paused"]);

/** One Constellation's items, or null when nothing in it waits on the user. */
const groupOf = ({
  hostKey,
  view,
  hosts,
  models,
  lookup,
}: GroupInput): ConstellationGroup | null => {
  const { constellation } = view;

  if (!LIVE.has(constellation.state)) return null;
  const key = `${hostKey}\u0000${constellation.id}`;
  const lead = models[hostKey]?.sessions.get(constellation.leadSessionId) ?? null;
  const rows = workerRows(view, lookup);

  const items = ordered([
    ...rows.flatMap((row) => workerItems(row, key)),
    ...setupItems(view, { hosts, models }, key),
    ...questionItems(view, rows, key),
    ...leadItems(hostKey, lead, key),
    ...claimItems(rows, key, constellation.state === "paused"),
  ]);

  return items.length === 0 ? null : { key, view, leadHostKey: hostKey, lead, items };
};

const byUrgency = (a: ConstellationGroup, b: ConstellationGroup) => {
  const [x, y] = [a.items[0], b.items[0]];

  if (x === undefined || y === undefined) return 0;

  return rank(x) - rank(y) || x.since.localeCompare(y.since);
};

/** Every live Constellation's items, groups ordered by their most urgent item, then its age. */
export const buildConstellationInbox = ({
  hosts,
  models,
  views,
}: ConstellationInput): ConstellationInbox => {
  const lookup = lookupIn(hosts, models);

  const groups = Object.entries(views)
    .flatMap(([hostKey, list]) =>
      list.flatMap((view) => groupOf({ hostKey, view, hosts, models, lookup }) ?? [])
    )
    .sort(byUrgency);

  const sessions = new Set(
    groups.flatMap((g) =>
      g.items.flatMap((i) =>
        i.hostKey === null || i.entry === null ? [] : [inboxKey(i.hostKey, i.entry.session.id)]
      )
    )
  );

  return { groups, sessions };
};

/**
 * The inbox with its count covering Constellation items too. Its lists keep every session, so
 * notifications still fire for a worker's approval; the inbox view moves them to their groups.
 */
export const withConstellations = <I extends Inbox>(inbox: I, c: ConstellationInbox): I => {
  const extra = new Set<string>();

  for (const group of c.groups) {
    for (const item of group.items) {
      const key =
        item.hostKey === null || item.entry === null
          ? item.key
          : inboxKey(item.hostKey, item.entry.session.id);

      if (item.entry === null || !needsYou(item.entry)) extra.add(key);
    }
  }

  return { ...inbox, count: inbox.count + extra.size };
};
