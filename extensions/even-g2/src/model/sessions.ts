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

/** A list container holds at most 20 rows of 63 UTF-8 bytes each. */
export const MAX_ROWS = 20;

export const MAX_ROW_BYTES = 63;

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

const encoder = new TextEncoder();

/** The glasses count text in UTF-8 bytes: "·" is two, "…" three. */
export const bytesOf = (text: string) => encoder.encode(text).byteLength;

const ELLIPSIS = "…";

const segmenter = new Intl.Segmenter();

/** Whole graphemes, so a cut never splits an emoji or an accent from its letter. */
const graphemes = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);

/** The longest run of whole graphemes from `chars` that fits in `max` bytes. */
const fitting = (chars: ReadonlyArray<string>, max: number) => {
  const kept: Array<string> = [];
  let used = 0;

  for (const char of chars) {
    used += bytesOf(char);

    if (used > max) break;
    kept.push(char);
  }

  return kept;
};

/** Cuts `text` to `max` UTF-8 bytes, ending in an ellipsis when it was longer. */
export const clip = (text: string, max: number) =>
  bytesOf(text) <= max
    ? text
    : `${fitting(graphemes(text), max - bytesOf(ELLIPSIS))
        .join("")
        .trimEnd()}${ELLIPSIS}`;

/** Keeps the last `max` UTF-8 bytes of `text`, starting with an ellipsis when it was longer. */
export const tail = (text: string, max: number) =>
  bytesOf(text) <= max
    ? text
    : `${ELLIPSIS}${fitting(graphemes(text).toReversed(), max - bytesOf(ELLIPSIS))
        .toReversed()
        .join("")}`;

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
    MAX_ROW_BYTES
  );
