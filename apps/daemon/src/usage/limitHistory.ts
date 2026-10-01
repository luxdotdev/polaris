// Portions adapted from steipete/CodexBar@2ef5bb6 (MIT): the session-equivalent burn estimate
// (Sources/CodexBar/SessionEquivalentForecast.swift).
/**
 * A short history of Plan Limit readings, so the Daemon can say how much of
 * the weekly window a full 5-hour window typically uses. Readings go in as
 * they're reported and old ones are pruned on the same write: no timer, no
 * idle cost. Kept for the weekly window (the longest a Harness reports).
 */
import type { Database } from "bun:sqlite";
import type { PlanLimit } from "@polaris/protocol";

export interface Reading {
  readonly observed: number;
  readonly used: number;
  readonly resets: number;
}

const HOUR_MS = 3_600_000;

/** A week: the 5-hour windows a weekly estimate needs all lie within its own window. */
export const RETAIN_MS = 7 * 24 * HOUR_MS;

/** Per window, a ceiling well above a week of readings (the reporter sends at most one a minute unless it moves). */
export const MAX_READINGS = 5_000;

/** Readings of one window whose reset times differ by less than this are the same window. */
const RESET_TOLERANCE_MS = 2 * 60_000;

/** Readings of the two windows this close together were reported together. */
const PAIR_TOLERANCE_MS = 60_000;

/** The recent 5-hour windows the median is taken over, and how many it needs. */
const SAMPLE_LIMIT = 7;

const MIN_SAMPLES = 3;

export const HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS plan_limit_history (
  key TEXT NOT NULL,
  observed INTEGER NOT NULL,
  used REAL NOT NULL,
  resets INTEGER NOT NULL,
  PRIMARY KEY (key, observed)
) WITHOUT ROWID;
`;

/** A limit's history key: harness, kind and scope, as `UsageIndex` keys the latest value. */
export const historyKey = (limit: Pick<PlanLimit, "harness" | "kind" | "scope">) =>
  `${limit.harness}\u0000${limit.kind}\u0000${limit.scope ?? ""}`;

export const limitHistory = (db: Database) => {
  db.run(HISTORY_SCHEMA);

  const statements = {
    put: db.query(
      "INSERT OR REPLACE INTO plan_limit_history (key, observed, used, resets) VALUES (?, ?, ?, ?)"
    ),
    pruneOld: db.query("DELETE FROM plan_limit_history WHERE key = ? AND observed < ?"),
    pruneMany: db.query(
      `DELETE FROM plan_limit_history WHERE key = ?1 AND observed <= (
         SELECT observed FROM plan_limit_history WHERE key = ?1
         ORDER BY observed DESC LIMIT 1 OFFSET ?2)`
    ),
    readings: db.query<Reading, [string, number]>(
      "SELECT observed, used, resets FROM plan_limit_history WHERE key = ? AND observed >= ? ORDER BY observed"
    ),
  };

  return {
    /** Keeps a reading that has a percentage and a reset; drops what has aged out. */
    record: (limit: PlanLimit) => {
      if (limit.usedPercent === null || limit.resetsAt === null) return;
      const key = historyKey(limit);
      const observed = Date.parse(limit.observedAt);
      const windowMs = (limit.windowMinutes ?? 0) * 60_000;

      db.transaction(() => {
        statements.put.run(key, observed, limit.usedPercent, Date.parse(limit.resetsAt ?? ""));
        statements.pruneOld.run(key, observed - Math.max(RETAIN_MS, windowMs));
        statements.pruneMany.run(key, MAX_READINGS);
      })();
    },
    readings: (key: string, since: number): ReadonlyArray<Reading> =>
      statements.readings.all(key, since),
  };
};

export type LimitHistory = ReturnType<typeof limitHistory>;

interface Group {
  readonly resets: number;
  readonly readings: Array<Reading>;
}

/** 5-hour readings grouped by window (their reset), oldest first. */
const groupByWindow = (readings: ReadonlyArray<Reading>): ReadonlyArray<Group> => {
  const groups: Array<Group> = [];

  for (const r of readings) {
    const last = groups.at(-1);

    if (last !== undefined && Math.abs(last.resets - r.resets) <= RESET_TOLERANCE_MS)
      last.readings.push(r);
    else groups.push({ resets: r.resets, readings: [r] });
  }

  return groups;
};

const nearest = (weekly: ReadonlyArray<Reading>, at: number) => {
  let best: Reading | undefined;

  for (const w of weekly) {
    if (Math.abs(w.observed - at) > PAIR_TOLERANCE_MS) continue;

    if (best === undefined || Math.abs(w.observed - at) < Math.abs(best.observed - at)) best = w;
  }

  return best;
};

/** How much of the weekly window one finished 5-hour window used, scaled to a full one. */
const burnOf = (group: Group, weekly: ReadonlyArray<Reading>): number | null => {
  const pairs = group.readings.flatMap((r) => {
    const w = nearest(weekly, r.observed);

    return w === undefined ? [] : [{ session: r.used, weekly: w }];
  });

  const first = pairs[0];
  const last = pairs.at(-1);

  if (first === undefined || last === undefined) return null;

  // Both ends within one weekly window, or the weekly reset sits between them.
  if (Math.abs(first.weekly.resets - last.weekly.resets) > RESET_TOLERANCE_MS) return null;
  const session = last.session - first.session;
  const weeklyBurn = last.weekly.used - first.weekly.used;

  return session > 0 && weeklyBurn > 0 ? (100 * weeklyBurn) / session : null;
};

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
};

/**
 * The median share of the weekly window a full 5-hour window used, over the
 * last finished 5-hour windows; null below three of them (not well-founded).
 */
export const weeklyPerSession = (
  fiveHour: ReadonlyArray<Reading>,
  weekly: ReadonlyArray<Reading>,
  now: number
): number | null => {
  const finished = groupByWindow(fiveHour).filter((g) => g.resets <= now);

  const burns = finished
    .slice(-SAMPLE_LIMIT)
    .map((g) => burnOf(g, weekly))
    .filter((b): b is number => b !== null);

  if (burns.length < MIN_SAMPLES) return null;
  const value = median(burns);

  return Number.isFinite(value) && value > 0 ? value : null;
};
