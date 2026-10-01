/**
 * Usage → By Constellation (spec §9): derived from the Usage buckets already read, nothing
 * new recorded. Each Constellation's tokens and cost split by role (Lead, workers), per Task,
 * and its wall-clock duration. Pure, so it is tested.
 */
import type { Attempt } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import type { ConstellationView } from "../../sessions/source.ts";
import {
  addCost,
  type Bucket,
  bucketCost,
  type Cost,
  type Estimator,
  NO_COST,
  noEstimate,
  totalTokens,
} from "./usage.ts";

export interface Spend {
  readonly tokens: number;
  readonly cost: Cost;
}

const NONE: Spend = { tokens: 0, cost: NO_COST };

const plus = (a: Spend, b: Spend): Spend => ({
  tokens: a.tokens + b.tokens,
  cost: addCost(a.cost, b.cost),
});

export interface TaskSpend extends Spend {
  readonly taskId: string;
  readonly title: string;
  readonly attempts: number;
}

export interface ConstellationSpend {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly lead: Spend;
  readonly workers: Spend;
  readonly total: Spend;
  /** Workers' spend per Task, most first; a Gate's spend is the Lead's. */
  readonly tasks: ReadonlyArray<TaskSpend>;
  /** From its start to completion, or to now while it runs. */
  readonly durationMs: number;
}

const HOUR_MS = 3_600_000;

/** A bucket's hour overlaps the Attempt's run (hourly buckets, so attribution is to the hour). */
const during = (bucket: Bucket, attempt: Plain<Attempt>, now: number) => {
  const hour = Date.parse(bucket.hour);
  const end = attempt.endedAt == null ? now : Date.parse(attempt.endedAt);

  return hour + HOUR_MS > Date.parse(attempt.startedAt) && hour <= end;
};

const spendOf = (bucket: Bucket, estimate: Estimator): Spend => ({
  tokens: totalTokens(bucket.tokens),
  cost: bucketCost(bucket, estimate),
});

interface SpendInput {
  readonly buckets: ReadonlyArray<Bucket>;
  readonly views: ReadonlyArray<ConstellationView>;
  readonly now: number;
  readonly estimate?: Estimator;
}

const oneConstellation = (
  view: ConstellationView,
  bySession: ReadonlyMap<string, ReadonlyArray<Bucket>>,
  now: number,
  estimate: Estimator
): ConstellationSpend => {
  const { constellation: c } = view;
  let lead = NONE;
  const perTask = new Map<string, Spend>();

  for (const b of bySession.get(c.leadSessionId) ?? []) lead = plus(lead, spendOf(b, estimate));

  const workerSessions = new Set(
    c.attempts.flatMap((a): Array<string> => (a.sessionId === c.leadSessionId ? [] : [a.sessionId]))
  );

  for (const sessionId of workerSessions) {
    const attempts = c.attempts.filter((a) => a.sessionId === sessionId);

    for (const b of bySession.get(sessionId) ?? []) {
      // The latest Attempt running at that hour takes it; a session carries one at a time.
      const attempt = attempts.findLast((a) => during(b, a, now)) ?? attempts.at(-1);

      if (attempt !== undefined)
        perTask.set(
          attempt.taskId,
          plus(perTask.get(attempt.taskId) ?? NONE, spendOf(b, estimate))
        );
    }
  }

  const tasks = c.tasks
    .flatMap((t): Array<TaskSpend> => {
      const spend = perTask.get(t.id);

      return spend === undefined
        ? []
        : [
            {
              ...spend,
              taskId: t.id,
              title: t.title,
              attempts: c.attempts.filter((a) => a.taskId === t.id).length,
            },
          ];
    })
    .sort((a, b) => b.tokens - a.tokens);

  const workers = tasks.reduce<Spend>((s, t) => plus(s, t), NONE);
  const ended = c.state === "completed" || c.state === "archived";

  return {
    id: c.id,
    name: c.name,
    state: c.state,
    lead,
    workers,
    total: plus(lead, workers),
    tasks,
    durationMs: Math.max(0, (ended ? Date.parse(c.updatedAt) : now) - Date.parse(c.createdAt)),
  };
};

/** Every Constellation with any Usage in the buckets, most tokens first. */
export const byConstellation = ({
  buckets,
  views,
  now,
  estimate = noEstimate,
}: SpendInput): ReadonlyArray<ConstellationSpend> => {
  const bySession = new Map<string, Array<Bucket>>();

  for (const b of buckets) {
    if (b.sessionId === null) continue;
    const list = bySession.get(b.sessionId);

    if (list === undefined) bySession.set(b.sessionId, [b]);
    else list.push(b);
  }

  return views
    .map((v) => oneConstellation(v, bySession, now, estimate))
    .filter((s) => s.total.tokens > 0)
    .sort((a, b) => b.total.tokens - a.total.tokens);
};

/** "2h 14m", "41m", "3d 2h". */
export const duration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};
