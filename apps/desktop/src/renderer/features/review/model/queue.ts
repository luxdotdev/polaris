/**
 * Review's queue (Paper R1 1TC-0, DESIGN.md Review → Queue): Review requested, Agent
 * sessions ready, Mine, Other open. An Agent Session is ready when its last Turn ended
 * and some Turns are not yet accepted; the newest first, a few at most.
 */
import type { SessionId } from "@polaris/protocol";
import type { OpenPull } from "../../../../shared/api.ts";
import { type PullListView, type PullRowView, repoOfRow } from "../../../../shared/github.ts";

export interface QueuePull {
  readonly kind: "pull";
  readonly id: string;
  readonly pull: OpenPull;
  readonly title: string;
  readonly meta: string;
  readonly number: number;
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
  readonly id: "requested" | "sessions" | "mine" | "other";
  readonly label: string;
  readonly rows: ReadonlyArray<QueueRow>;
  /** Two-line rows with a tile (requested, sessions) or one-line rows with the number. */
  readonly compact: boolean;
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

const pullRow = (row: PullRowView): QueuePull => {
  const repo = repoOfRow(row);
  const { name } = repo;

  return {
    kind: "pull",
    id: row.id,
    pull: { repo, number: row.number, pullId: row.id },
    title: row.title,
    meta: `#${row.number} · ${name} · ${row.author?.login ?? "ghost"}`,
    number: row.number,
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

export const queueGroups = (
  list: PullListView | null,
  sessions: ReadonlyArray<SessionInfo>
): ReadonlyArray<QueueGroup> => {
  const groups: ReadonlyArray<QueueGroup> = [
    {
      id: "requested",
      label: "Review requested",
      rows: (list?.requested ?? []).map(pullRow),
      compact: false,
    },
    {
      id: "sessions",
      label: "Agent sessions ready",
      rows: readySessions(sessions),
      compact: false,
    },
    { id: "mine", label: "Mine", rows: (list?.mine ?? []).map(pullRow), compact: true },
    { id: "other", label: "Other open", rows: (list?.other ?? []).map(pullRow), compact: true },
  ];

  return groups.filter((g) => g.rows.length > 0);
};
