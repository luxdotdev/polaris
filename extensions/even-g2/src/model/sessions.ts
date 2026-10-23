/**
 * The Sessions screen's rows: every paired Host's Agent Sessions, Needs You
 * first, then Working, then Idle, then the rest; newest first within each.
 */
import type { HostView, SessionEntry, SessionState } from "@polaris/sdk";

export interface SessionKey {
  readonly hostId: string;
  readonly sessionId: string;
}

export interface SessionRow {
  readonly key: SessionKey;
  readonly hostName: string;
  readonly entry: SessionEntry;
}

/** A list container holds at most 20 rows of 64 characters. */
export const MAX_ROWS = 20;

export const MAX_ROW_CHARS = 64;

const GROUP: Record<SessionState, number> = {
  "needs-you": 0,
  starting: 1,
  working: 1,
  idle: 2,
  "in-terminal": 3,
  dormant: 3,
  failed: 3,
  limited: 3,
  archived: 4,
};

export const STATE_LABEL: Record<SessionState, string> = {
  "needs-you": "Needs you",
  starting: "Starting",
  working: "Working",
  idle: "Idle",
  "in-terminal": "In terminal",
  dormant: "Dormant",
  failed: "Failed",
  limited: "Limited",
  archived: "Archived",
};

export const sameKey = (a: SessionKey, b: SessionKey) =>
  a.hostId === b.hostId && a.sessionId === b.sessionId;

/** Cuts `text` to `max` characters, ending in an ellipsis when it was longer. */
export const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export const titleOf = (entry: SessionEntry) => entry.session.title.trim() || "Untitled session";

export const sessionRows = (hosts: ReadonlyArray<HostView>): ReadonlyArray<SessionRow> =>
  hosts
    .flatMap((host) =>
      host.sessions
        .filter((entry) => entry.session.state !== "archived")
        .map((entry) => ({
          key: { hostId: host.hostId, sessionId: entry.session.id },
          hostName: host.hostName,
          entry,
        }))
    )
    .toSorted(
      (a, b) =>
        GROUP[a.entry.session.state] - GROUP[b.entry.session.state] ||
        b.entry.session.updatedAt.localeCompare(a.entry.session.updatedAt)
    );

export const findRow = (hosts: ReadonlyArray<HostView>, key: SessionKey) =>
  sessionRows(hosts).find((row) => sameKey(row.key, key));

/** "Needs you · Fix the flaky test", with the Host's name when several are paired. */
export const rowLabel = (row: SessionRow, manyHosts: boolean) =>
  clip(
    [
      STATE_LABEL[row.entry.session.state],
      titleOf(row.entry),
      ...(manyHosts ? [row.hostName] : []),
    ].join(" · "),
    MAX_ROW_CHARS
  );
