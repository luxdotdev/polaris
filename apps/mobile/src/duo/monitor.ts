/**
 * The half-folded Duo idle as a monitor (Paper D8): agent sessions as labelled stars in the
 * night sky above the fold, needs you items as targets below it. Pure; `Monitor` draws it.
 */
import type { HarnessKind } from "@polaris/protocol";
import type { Home, HomeRow, SessionRow } from "../home/model/home.ts";

export type StarTone = "needs-you" | "working";

export interface Star {
  readonly key: string;
  readonly label: string;
  readonly tone: StarTone;
  readonly harness: HarnessKind | null;
  /** Where in the sky, 0–1 across and down. */
  readonly x: number;
  readonly y: number;
}

/** "Polaris planning" → "polaris-planning", as D8 labels its stars. */
export const starLabel = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "untitled" : slug.length > 22 ? `${slug.slice(0, 21)}…` : slug;
};

/** A small stable hash, so a session keeps its place in the sky between renders. */
const hash = (text: string): number => {
  let h = 2166136261;

  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);

  return (h >>> 0) / 4294967295;
};

const COLUMNS = 3;

/** Each star gets its own cell of a 3-wide grid, jittered within it, so labels never collide. */
const place = (key: string, index: number, count: number) => {
  const rows = Math.max(1, Math.ceil(count / COLUMNS));
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const jitterX = hash(`${key}:x`) * 0.5;
  const jitterY = hash(`${key}:y`) * 0.5;

  return {
    x: 0.06 + ((column + 0.1 + jitterX) / COLUMNS) * 0.74,
    y: (row + 0.2 + jitterY) / rows,
  };
};

const rowLabel = (row: HomeRow): string =>
  row.kind === "session" ? starLabel(row.session.title) : starLabel(row.constellation.name);

/** At most this many stars; the rest of a busy night stays on Home. */
export const STAR_LIMIT = 9;

export const starsOf = (home: Home): ReadonlyArray<Star> => {
  const lit: ReadonlyArray<{ readonly row: HomeRow; readonly tone: StarTone }> = [
    ...home.sections.needsYou.map((row) => ({ row, tone: "needs-you" as const })),
    ...home.sections.working.map((row) => ({ row, tone: "working" as const })),
  ].slice(0, STAR_LIMIT);

  return lit.map(({ row, tone }, index) => ({
    key: row.key,
    label: rowLabel(row),
    tone,
    harness: row.kind === "session" ? row.session.harness : (row.lead?.harness ?? null),
    ...place(row.key, index, lit.length),
  }));
};

/** "3 working · 2 need you"; empty when nothing is going on. */
export const skyLine = (home: Home) => ({
  working: home.working === 0 ? "" : `${home.working} working`,
  needsYou: home.needsYou === 0 ? "" : `${home.needsYou} need${home.needsYou === 1 ? "s" : ""} you`,
});

/** Night is 22:00 to 6:00 on this iPhone: the targets dim, as the Duo stands on a nightstand. */
export const isNight = (hour: number): boolean => hour >= 22 || hour < 6;

/** The targets below the fold: needs you rows that can be answered here. */
export const targetsOf = (home: Home, limit: number): ReadonlyArray<SessionRow> =>
  home.sections.needsYou.filter((row) => row.approval !== null).slice(0, limit);
