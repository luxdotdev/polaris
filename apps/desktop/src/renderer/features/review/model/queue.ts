/**
 * Review's queue (Paper R1 1TC-0, DESIGN.md Review → Queue): Review requested, Agent
 * sessions ready, Mine, Other open, then Reviewed (closed by default). An Agent Session is
 * ready when its last Turn ended and some Turns are not yet accepted; the newest first, a
 * few at most. Where a reviewed pull request goes is `reviewed.ts`'s.
 */
import type { SessionId } from "@polaris/protocol";
import type { OpenPull } from "../../../../shared/api.ts";
import {
  type PullListView,
  type PullRowView,
  repoOfRow,
  type ViewerReview,
} from "../../../../shared/github.ts";
import { type LocalReviews, placePulls } from "./reviewed.ts";

export interface QueuePull {
  readonly kind: "pull";
  readonly id: string;
  readonly pull: OpenPull;
  readonly title: string;
  readonly meta: string;
  readonly number: number;
  /** Its page on GitHub. */
  readonly url: string;
  readonly head: string;
  /** Back in Review requested after new commits: the commit the viewer's review was on. */
  readonly since: ViewerReview | null;
}

export interface QueueSession {
  readonly kind: "session";
  readonly id: string;
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly harness: string;
  readonly title: string;
  readonly meta: string;
}

export type QueueRow = QueuePull | QueueSession;

export interface QueueGroup {
  readonly id: "requested" | "claims" | "sessions" | "mine" | "other" | "reviewed";
  readonly label: string;
  readonly rows: ReadonlyArray<QueueRow>;
  /** Two-line rows with a tile (requested, sessions) or one-line rows with the number. */
  readonly compact: boolean;
  /** It folds under its header (Reviewed). */
  readonly collapsible?: boolean;
}

/** What the queue needs of an Agent Session (`SessionData`). */
export interface SessionInfo {
  readonly hostKey: string;
  readonly id: SessionId;
  readonly title: string;
  readonly harness: string;
  readonly state: string;
  readonly turnCount: number;
  readonly acceptedThroughIndex: number | null;
  readonly updatedAt: string;
  readonly workspaceName: string | null;
}

/** Ready sessions shown at most. */
export const READY_LIMIT = 5;

const READY_STATES = new Set(["idle", "dormant"]);

const pullRow = (row: PullRowView, since: ViewerReview | null = null): QueuePull => {
  const repo = repoOfRow(row);
  const { name } = repo;

  return {
    kind: "pull",
    id: row.id,
    pull: { repo, number: row.number, pullId: row.id },
    title: row.title,
    meta: `#${row.number} · ${name} · ${row.author?.login ?? "ghost"}`,
    number: row.number,
    url: row.url,
    head: row.headRefOid,
    since,
  };
};

const turnsCaption = (first: number, last: number) =>
  first === last ? `Turn ${last}` : `Turns ${first}–${last}`;

export const readySessions = (sessions: ReadonlyArray<SessionInfo>): ReadonlyArray<QueueSession> =>
  sessions
    .filter((s) => READY_STATES.has(s.state) && s.turnCount - 1 > (s.acceptedThroughIndex ?? -1))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, READY_LIMIT)
    .map((s) => ({
      kind: "session",
      id: `${s.hostKey}:${s.id}`,
      hostKey: s.hostKey,
      sessionId: s.id,
      harness: s.harness,
      title: s.title,
      meta: [turnsCaption((s.acceptedThroughIndex ?? -1) + 2, s.turnCount), s.workspaceName]
        .filter((part) => part !== null)
        .join(" · "),
    }));

/** Worker sessions of Constellations: their Claims in review, and every worker to leave out. */
export interface Workers {
  readonly claims: ReadonlyArray<QueueSession>;
  readonly workers: ReadonlySet<string>;
}

const NO_WORKERS: Workers = { claims: [], workers: new Set() };

/** Sessions that aren't a Constellation's workers: the Lead, not the session Accept, takes those. */
export const notWorkers = (
  sessions: ReadonlyArray<SessionInfo>,
  workers: ReadonlySet<string>
): ReadonlyArray<SessionInfo> => sessions.filter((s) => !workers.has(`${s.hostKey}:${s.id}`));

export const queueGroups = (
  list: PullListView | null,
  all: ReadonlyArray<SessionInfo>,
  workers: Workers = NO_WORKERS,
  local: LocalReviews = {},
  now: number = Date.now()
): ReadonlyArray<QueueGroup> => {
  const sessions = notWorkers(all, workers.workers);
  const placed = placePulls(list, local, now);

  const groups: ReadonlyArray<QueueGroup> = [
    {
      id: "requested",
      label: "Review requested",
      rows: placed.requested.map((p) => pullRow(p.row, p.since)),
      compact: false,
    },
    { id: "claims", label: "Workers' claims", rows: workers.claims, compact: false },
    {
      id: "sessions",
      label: "Agent sessions ready",
      rows: readySessions(sessions),
      compact: false,
    },
    {
      id: "mine",
      label: "Mine",
      rows: (list?.mine ?? []).map((row) => pullRow(row)),
      compact: true,
    },
    {
      id: "other",
      label: "Other open",
      rows: placed.other.map((row) => pullRow(row)),
      compact: true,
    },
    {
      id: "reviewed",
      label: "Reviewed",
      rows: placed.reviewed.map((r) => pullRow(r.row)),
      compact: true,
      collapsible: true,
    },
  ];

  return groups.filter((g) => g.rows.length > 0);
};

/** The rows ⌃1…⌃9 reach, in the order they show: a folded group's are out of sight. */
export const visibleRows = (groups: ReadonlyArray<QueueGroup>, reviewedOpen: boolean) =>
  groups.flatMap((group) => (group.collapsible === true && !reviewedOpen ? [] : group.rows));

/** Where the queue goes once a review is submitted; `stay` when it can't say. */
export type Advance =
  | { readonly kind: "open"; readonly row: QueueRow }
  | { readonly kind: "done"; readonly group: QueueGroup["id"] }
  | { readonly kind: "stay" };

/** Groups whose pull requests move to Reviewed once reviewed. */
const ADVANCING = new Set<QueueGroup["id"]>(["requested", "other"]);

/**
 * After reviewing `id`: the next row of its group in the queue's order (the one after it,
 * else the first left), or done when it was the group's last.
 */
export const advanceFrom = (groups: ReadonlyArray<QueueGroup>, id: string): Advance => {
  const group = groups.find((g) => g.rows.some((r) => r.id === id));

  if (group === undefined || !ADVANCING.has(group.id)) return { kind: "stay" };
  const at = group.rows.findIndex((r) => r.id === id);
  const next = group.rows[at + 1] ?? group.rows.find((r) => r.id !== id);

  return next === undefined ? { kind: "done", group: group.id } : { kind: "open", row: next };
};
