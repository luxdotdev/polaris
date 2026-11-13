/**
 * Origins in the editor (DESIGN.md, Origins; ADR 0111): each Host's `origins.match` answer
 * merged per line, and the inline annotation's and hover card's copy. Pure: times come in.
 */
import type {
  BlameCommit,
  OriginLine,
  OriginSession,
  OriginTurn,
  SessionId,
} from "@polaris/protocol";

/** One Host's answer for a file's lines: still asked, answered, or not reachable. */
export type HostAnswer =
  | { readonly kind: "pending" }
  | {
      readonly kind: "answered";
      readonly lines: ReadonlyArray<OriginLine>;
      readonly sessions: ReadonlyArray<OriginSession>;
    }
  | { readonly kind: "offline" };

export interface HostOrigins {
  readonly hostKey: string;
  /** The Host's name, as the offline row says it ("Linux VM"). */
  readonly label: string;
  readonly answer: HostAnswer;
}

/** A session that wrote the line, with only the Turns of it that did. */
export interface LineSession {
  readonly hostKey: string;
  readonly session: OriginSession;
  readonly turns: ReadonlyArray<OriginTurn>;
  /** Its newest matching Turn's time. */
  readonly time: number;
}

export interface MergedLine {
  /** Newest first. */
  readonly sessions: ReadonlyArray<LineSession>;
  /** Hosts still answering. */
  readonly pending: number;
  /** The labels of Hosts that couldn't be asked. */
  readonly offline: ReadonlyArray<string>;
}

const sessionKey = (hostKey: string, sessionId: SessionId) => `${hostKey}\u0000${sessionId}`;

/** Adds one Host's Origins for `line` to `into`, a session's Turns unioned if it repeats. */
const addAnswer = (
  into: Map<string, LineSession>,
  hostKey: string,
  answer: Extract<HostAnswer, { kind: "answered" }>,
  line: number
) => {
  const found = answer.lines.find((l) => l.line === line);

  for (const origin of found?.origins ?? []) {
    const session = answer.sessions.find((s) => s.sessionId === origin.sessionId);

    if (session === undefined) continue;
    const key = sessionKey(hostKey, session.sessionId);
    const known = into.get(key)?.turns ?? [];
    const wanted = new Set(origin.turnIds);

    const added = session.turns.filter(
      (t) => wanted.has(t.turnId) && !known.some((k) => k.turnId === t.turnId)
    );

    const turns = [...known, ...added].toSorted((a, b) => a.time - b.time);

    into.set(key, { hostKey, session, turns, time: turns.at(-1)?.time ?? 0 });
  }
};

/** The line's Origins from every Host that answered; one that hasn't or can't never holds the rest. */
export const mergeLine = (line: number, hosts: ReadonlyArray<HostOrigins>): MergedLine => {
  const sessions = new Map<string, LineSession>();
  let pending = 0;
  const offline: Array<string> = [];

  for (const host of hosts) {
    const { answer } = host;

    if (answer.kind === "pending") pending++;
    else if (answer.kind === "offline") offline.push(host.label);
    else addAnswer(sessions, host.hostKey, answer, line);
  }

  return {
    sessions: [...sessions.values()].toSorted((a, b) => b.time - a.time),
    pending,
    offline,
  };
};

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Whole calendar days between two times, in local time. */
const calendarDays = (time: number, now: number) => {
  const day = (t: number) => {
    const d = new Date(t);

    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };

  return Math.round((day(now) - day(time)) / DAY);
};

/** "now", "5 minutes ago", "3 hours ago", "Yesterday", "2 days ago", "3 weeks ago", "4 months ago". */
export const ago = (time: number, now: number): string => {
  const elapsed = Math.max(0, now - time);
  const days = calendarDays(time, now);

  if (elapsed < MINUTE) return "now";

  if (elapsed < HOUR) return `${plural(Math.floor(elapsed / MINUTE), "minute")} ago`;

  if (days < 1) return `${plural(Math.floor(elapsed / HOUR), "hour")} ago`;

  if (days === 1) return "Yesterday";

  if (days < 14) return `${plural(days, "day")} ago`;

  if (days < 60) return `${plural(Math.floor(days / 7), "week")} ago`;

  return days < 365
    ? `${plural(Math.floor(days / 30), "month")} ago`
    : `${plural(Math.floor(days / 365), "year")} ago`;
};

/** In this week, an inline annotation's words; earlier, the date ("Oct 28", "Oct 28, 2025"). */
export const rowTime = (time: number, now: number): string => {
  if (thisWeek(time, now)) return ago(time, now);
  const date = new Date(time);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
};

export const thisWeek = (time: number, now: number) => calendarDays(time, now) < 7;

/** The annotation's session part: one session by its title, several by their count. */
export const sessionsText = (sessions: ReadonlyArray<LineSession>): string | null => {
  if (sessions.length === 0) return null;

  return sessions.length === 1
    ? (sessions[0]?.session.title ?? null)
    : `${sessions.length} sessions`;
};

/** The annotation's lead: "Lucas Doell, Yesterday", or "Not committed". */
export const annotationLead = (commit: BlameCommit | null, now: number) =>
  commit === null ? "Not committed" : `${commit.authorName}, ${ago(commit.time, now)}`;

/** "turn 12", "turns 18–21", or, from a Daemon that can't number them, "2 turns". */
export const turnsText = (turns: ReadonlyArray<OriginTurn>): string => {
  const numbers = turns.map((t) => t.number);

  if (numbers.length === 0 || numbers.some((n) => n < 1)) return plural(turns.length, "turn");
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);

  return low === high ? `turn ${low}` : `turns ${low}–${high}`;
};

/** After the Harness's name: "Working · turn 24", "turn 9 · Archived". */
export const sessionDetail = (line: LineSession): string => {
  const { session } = line;
  const turns = turnsText(line.turns);

  if (session.archived) return `${turns} · Archived`;

  return session.sessionState === "working" ? `Working · ${turns}` : turns;
};

/** The card's last Turn to open: the newest that wrote the line. */
export const openTurn = (line: LineSession): OriginTurn | null => line.turns.at(-1) ?? null;

/** "Open at turn 21" for a session row's hint. */
export const openHint = (line: LineSession) => {
  const turn = openTurn(line);

  return turn === null || turn.number < 1 ? "Open session" : `Open at turn ${turn.number}`;
};

export type Kicker = "This week" | "Earlier" | "Not committed";

export type CardRow =
  | { readonly kind: "commit"; readonly commit: BlameCommit; readonly time: number }
  | { readonly kind: "session"; readonly line: LineSession; readonly time: number };

export interface CardGroup {
  readonly kicker: Kicker;
  readonly rows: ReadonlyArray<CardRow>;
}

/** The card's rows under their kickers, newest first; a working-copy line's all sit under one. */
export const cardGroups = (
  commit: BlameCommit | null,
  merged: MergedLine,
  now: number
): ReadonlyArray<CardGroup> => {
  const rows: Array<CardRow> = [
    ...(commit === null ? [] : [{ kind: "commit" as const, commit, time: commit.time }]),
    ...merged.sessions.map((line) => ({ kind: "session" as const, line, time: line.time })),
  ].toSorted((a, b) => b.time - a.time);

  if (commit === null) return [{ kicker: "Not committed", rows }];
  const recent = rows.filter((r) => thisWeek(r.time, now));
  const earlier = rows.filter((r) => !thisWeek(r.time, now));

  return [
    { kicker: "This week" as const, rows: recent },
    { kicker: "Earlier" as const, rows: earlier },
  ].filter((g) => g.rows.length > 0);
};

/** Says no session wrote the line only once every Host has answered. */
export const noSessions = (merged: MergedLine) =>
  merged.sessions.length === 0 && merged.pending === 0 && merged.offline.length === 0;

/** "Finding sessions on 3 hosts…" */
export const findingText = (pending: number) => `Finding sessions on ${plural(pending, "host")}…`;

/**
 * The footer: counts and states joined by "·", only the first word capitalised
 * ("3 sessions · 1 commit", "1 commit · no sessions", "Not committed · 1 session").
 */
export const footerText = (commit: BlameCommit | null, merged: MergedLine): string => {
  const count = merged.sessions.length;
  const sessions = count === 0 ? null : plural(count, "session");

  const state =
    merged.pending > 0
      ? "finding sessions"
      : count === 0 && merged.offline.length === 0
        ? "no sessions"
        : null;

  const offline = merged.offline.map((label) => `${label} offline`);
  const lead = commit === null ? ["Not committed", sessions] : [sessions, "1 commit"];

  return [...lead, state, ...offline].filter((part) => part !== null).join(" · ");
};
