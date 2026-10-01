/**
 * Frecency (frequency and recency) of the user's picks in the `/` menu, from
 * Sightline's Find (`apps/web/src/lib/find/frecency.ts`). Pure: the table is a
 * value; `../frecencyStore.ts` keeps one per Host, Workspace and Harness.
 */

/** Most recent picks kept per entry, and how many entries a table keeps. */
const SAMPLED_PICKS = 10;

export const MAX_ENTRIES = 120;

export interface FrecencyEntry {
  /** Every pick, lifetime. */
  readonly count: number;
  /** The latest picks (epoch ms), newest first, at most `SAMPLED_PICKS`. */
  readonly picks: ReadonlyArray<number>;
}

export type FrecencyTable = Readonly<Record<string, FrecencyEntry>>;

const HOUR = 60 * 60 * 1000;

/** Mozilla-style bucketed weights: recent picks dominate, old ones linger. */
const pickWeight = (ageMs: number): number => {
  if (ageMs < HOUR) return 100;

  if (ageMs < 6 * HOUR) return 70;

  if (ageMs < 24 * HOUR) return 50;

  if (ageMs < 4 * 24 * HOUR) return 30;

  return ageMs < 14 * 24 * HOUR ? 10 : 5;
};

export const frecencyScore = (entry: FrecencyEntry | undefined, now: number): number => {
  if (entry === undefined || entry.picks.length === 0) return 0;
  const sum = entry.picks.reduce((total, at) => total + pickWeight(now - at), 0);

  return (sum / entry.picks.length) * Math.min(entry.count, 40);
};

/** The table after a pick of `key`; past `MAX_ENTRIES`, the lowest scores go. */
export const recordPick = (table: FrecencyTable, key: string, now: number): FrecencyTable => {
  const entry = table[key] ?? { count: 0, picks: [] };

  const picked: FrecencyEntry = {
    count: entry.count + 1,
    picks: [now, ...entry.picks].slice(0, SAMPLED_PICKS),
  };

  const entries = [...Object.entries(table).filter(([k]) => k !== key), [key, picked] as const];

  if (entries.length <= MAX_ENTRIES) return Object.fromEntries(entries);

  const kept = [...entries]
    .sort(([, a], [, b]) => frecencyScore(b, now) - frecencyScore(a, now))
    .slice(0, MAX_ENTRIES);

  return Object.fromEntries(kept);
};

/** Keys with a score, highest first. */
export const topFrecent = (table: FrecencyTable, limit: number, now: number): Array<string> =>
  Object.entries(table)
    .map(([key, entry]) => ({ key, score: frecencyScore(entry, now) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.key);
