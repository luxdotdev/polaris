/**
 * What the widgets show (Paper W1, W2), as JSON the WidgetKit extension reads from the App
 * Group: the summary ("2 need you · 3 working") and Home's top three agent sessions.
 */
import { Match } from "effect";
import type { Home, HomeRow, SessionRow } from "../home/model/home.ts";
import { HOME_LINK, sessionLink } from "./links.ts";

/** Bumped when the shape changes; the extension shows nothing for a version it doesn't know. */
export const WIDGET_SNAPSHOT_VERSION = 1;

export const WIDGET_ROWS = 3;

export type Tone = "needs-you" | "subtle" | "faint";

export interface SummaryPart {
  readonly text: string;
  readonly tone: Tone;
}

/** The glyph a row leads with: the raised hand, the Working dither, or done's dot. */
export type Glyph = "needs-you" | "working" | "starting" | "failed" | "done";

export interface WidgetRow {
  readonly hostId: string;
  readonly sessionId: string;
  readonly title: string;
  /** The Harness's kind; the extension maps it to its hue. */
  readonly harness: string;
  readonly glyph: Glyph;
  /** Shown as "turn 24" on working rows; null elsewhere. */
  readonly turn: number | null;
  /** When the age ("42m") counts from, in ms since the epoch; null on working rows. */
  readonly since: number | null;
  readonly link: string;
}

export interface WidgetSnapshot {
  readonly version: typeof WIDGET_SNAPSHOT_VERSION;
  readonly needsYou: number;
  readonly working: number;
  /** Joined with " · " on the lock screen; coloured part by part on the home screen. */
  readonly summary: ReadonlyArray<SummaryPart>;
  readonly rows: ReadonlyArray<WidgetRow>;
  /** Shown instead of rows when there are none. */
  readonly empty: string | null;
  /** No Host is connected: what's shown is as last seen. */
  readonly stale: boolean;
  readonly link: string;
}

const titleOf = (title: string) => (title.trim() === "" ? "Untitled agent session" : title);

const glyphOf = (row: SessionRow, needsYou: boolean): Glyph => {
  if (needsYou) return "needs-you";

  return Match.value(row.session.state).pipe(
    Match.when("working", () => "working" as const),
    Match.when("starting", () => "starting" as const),
    Match.when("failed", () => "failed" as const),
    Match.orElse(() => "done" as const)
  );
};

const widgetRow = (row: SessionRow, needsYou: boolean): WidgetRow => {
  const glyph = glyphOf(row, needsYou);
  const working = glyph === "working" || glyph === "starting";
  const turn = row.session.currentUserTurn?.number ?? row.session.turnCount;

  return {
    hostId: row.hostId,
    sessionId: row.session.id,
    title: titleOf(row.session.title),
    harness: row.session.harness,
    glyph,
    turn: working && turn > 0 ? turn : null,
    since: working ? null : row.since,
    link: sessionLink(row.hostId, row.session.id),
  };
};

const sessionsOf = (rows: ReadonlyArray<HomeRow>) =>
  rows.filter((row): row is SessionRow => row.kind === "session");

const summaryOf = (home: Home, stale: boolean): ReadonlyArray<SummaryPart> => {
  const parts: Array<SummaryPart> = [];

  if (home.needsYou > 0) parts.push({ text: `${home.needsYou} need you`, tone: "needs-you" });

  if (home.working > 0) parts.push({ text: `${home.working} working`, tone: "subtle" });

  if (parts.length === 0)
    parts.push({
      text: home.hostCount === 0 ? "No hosts yet" : "Nothing needs you",
      tone: "subtle",
    });

  if (stale && home.attention !== null) parts.push({ text: home.attention, tone: "faint" });

  return parts;
};

const emptyOf = (home: Home): string | null =>
  Match.value(home.empty).pipe(
    Match.when("no-hosts", () => "Link this iPhone from Polaris on your Mac"),
    Match.when("unreachable", () => "Can't reach your hosts"),
    Match.when("no-sessions", () => "No agent sessions yet"),
    Match.orElse(() => null)
  );

/** The widgets' snapshot of an unfiltered Home (`buildHome(hosts, null)`). */
export const widgetSnapshot = (home: Home, connectedHosts: number): WidgetSnapshot => {
  const stale = home.hostCount > 0 && connectedHosts === 0;
  const { needsYou, working, recent } = home.sections;

  const rows = [
    ...needsYou.map((row) => widgetRow(row, true)),
    ...sessionsOf(working).map((row) => widgetRow(row, false)),
    ...sessionsOf(recent).map((row) => widgetRow(row, false)),
  ].slice(0, WIDGET_ROWS);

  return {
    version: WIDGET_SNAPSHOT_VERSION,
    needsYou: home.needsYou,
    working: home.working,
    summary: summaryOf(home, stale),
    rows,
    empty: rows.length === 0 ? emptyOf(home) : null,
    stale,
    link: HOME_LINK,
  };
};
