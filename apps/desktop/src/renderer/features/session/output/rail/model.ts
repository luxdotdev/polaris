/**
 * The closed Output rail's facts (DESIGN.md, Output; Paper 0.11.0 R1, R2): what the session
 * is doing, its changed files, and where it runs. Pure, so each state is tested.
 */
import type { ConnectionState, SessionState } from "@polaris/protocol";
import { capitalize } from "effect/String";
import { formatElapsed } from "../../model/format.ts";
import { type DiffFile, totals } from "../../model/diff.ts";
import { elapsedLabel } from "../../../../shell/offline.ts";
import { connectionLabel, sessionStateLabel, usageLimitLine } from "../../../../shell/copy.ts";

/** The rail lists this many changed files, then "and N more". */
export const RAIL_FILES = 5;

export interface RailChanges {
  readonly count: number;
  readonly added: number;
  readonly removed: number;
  /** The first `RAIL_FILES`, in the diff's order. */
  readonly shown: ReadonlyArray<DiffFile>;
  /** How many files the list leaves out. */
  readonly more: number;
}

export const railChanges = (files: ReadonlyArray<DiffFile>, limit = RAIL_FILES): RailChanges => {
  const sum = totals(files);
  const shown = files.slice(0, limit);

  return {
    count: sum.files,
    added: sum.added,
    removed: sum.removed,
    shown,
    more: sum.files - shown.length,
  };
};

/** Cells kept after the ellipsis, so a long name keeps its end ("ClaudeDri…test.ts"). */
const TAIL = 8;

/** `name` in at most `cells` mono cells, cut in its middle; whole when it fits. */
export const middleCut = (name: string, cells: number): string => {
  if (name.length <= cells) return name;

  if (cells < 3) return name.slice(0, Math.max(0, cells));
  const tail = Math.min(TAIL, Math.floor((cells - 1) / 2));

  return `${name.slice(0, cells - 1 - tail)}…${name.slice(name.length - tail)}`;
};

/** "↑3", "↓2", "↑3 ↓2"; null when the branch is even with its upstream. */
export const aheadBehind = (ahead: number, behind: number): string | null => {
  const parts = [...(ahead > 0 ? [`↑${ahead}`] : []), ...(behind > 0 ? [`↓${behind}`] : [])];

  return parts.length === 0 ? null : parts.join(" ");
};

/** A line with its trailing command or file name in code type ("Running `bun test`"). */
export interface Phrase {
  readonly text: string;
  readonly code: string | null;
}

const CODE_TAIL = /^(Wants to run|Running|Editing) (.+)$/;

/** Splits off the command or file our own copy ends with; counts and ellipses stay prose. */
export const phrase = (text: string): Phrase => {
  const match = CODE_TAIL.exec(text);
  const tail = match?.[2];

  if (match === null || tail === undefined || tail.endsWith("…") || /^\d+ files$/.test(tail))
    return { text, code: null };

  return { text: `${match[1]} `, code: tail };
};

export type ActivityGlyph = "session" | "connection";

export interface Activity {
  readonly glyph: ActivityGlyph;
  readonly title: Phrase;
  /** Needs You's text colour: something waits on the user. */
  readonly attention: boolean;
  readonly sub: string;
}

export interface ActivityInput {
  readonly now: number;
  readonly host: {
    readonly label: string;
    readonly state: ConnectionState;
    readonly since: number;
  };
  readonly harness: string;
  readonly state: SessionState;
  /** The first pending request's line ("Wants to run cargo build", a question), if any. */
  readonly request: string | null;
  /** What a Working session is doing now (`activityOf`). */
  readonly live: string | null;
  /** "Waiting on 2 subagents" for an Idle session with background tasks. */
  readonly waiting: string | null;
  readonly turn: {
    readonly number: number;
    readonly startedAt: string;
    readonly endedAt: string | null;
  } | null;
  readonly lastError: string | null;
  readonly limitResetsAt: string | null;
}

const MINUTE = 60_000;

const since = (now: number, iso: string) => now - Date.parse(iso);

const turnPart = (input: ActivityInput) =>
  input.turn === null ? [] : [`turn ${input.turn.number}`];

const join = (parts: ReadonlyArray<string>) => parts.join(" · ");

/** Idle: when the latest Turn ended, or the Harness before it has one. */
const readySub = (input: ActivityInput) => {
  const turn = input.turn;

  if (turn === null) return input.harness;

  if (turn.endedAt === null) return `Turn ${turn.number}`;

  const ago = since(input.now, turn.endedAt);

  if (ago < MINUTE) return `Turn ${turn.number} just ended`;

  return `Turn ${turn.number} ended ${elapsedLabel(ago)} ago`;
};

const OTHER_SUBS: Partial<Record<SessionState, (input: ActivityInput) => string>> = {
  dormant: () => "Resumes on reply",
  failed: (i) => i.lastError ?? i.harness,
  limited: (i) => usageLimitLine(i.limitResetsAt),
};

const session = (
  input: ActivityInput,
  title: string,
  sub: string,
  attention = false
): Activity => ({
  glyph: "session",
  title: phrase(title),
  attention,
  sub,
});

/** The rail's first block: the Host's connection when it isn't connected, else the session. */
export const activity = (input: ActivityInput): Activity => {
  const { host } = input;

  if (host.state !== "connected")
    return {
      glyph: "connection",
      title: { text: capitalize(connectionLabel[host.state]), code: null },
      attention: false,
      sub: `${host.label} · seen ${elapsedLabel(input.now - host.since)} ago`,
    };

  if (input.request !== null)
    return session(input, input.request, join([input.harness, "waiting on you"]), true);

  if (input.state === "working" || input.state === "starting") {
    const elapsed =
      input.turn === null ? [] : [formatElapsed(since(input.now, input.turn.startedAt))];

    const title = input.live ?? capitalize(sessionStateLabel[input.state]);

    return session(input, title, join([input.harness, ...turnPart(input), ...elapsed]));
  }

  if (input.state === "idle")
    return input.waiting === null
      ? session(input, "Ready", readySub(input))
      : session(input, input.waiting, join([input.harness, ...turnPart(input)]));

  const sub = OTHER_SUBS[input.state]?.(input) ?? join([input.harness, ...turnPart(input)]);

  return session(input, capitalize(sessionStateLabel[input.state]), sub);
};
