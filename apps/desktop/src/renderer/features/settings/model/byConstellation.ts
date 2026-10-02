/**
 * Usage → By Constellation (spec §9): each Constellation's tokens and cost split by role (Lead,
 * workers), per Task, and its wall-clock time. Exact from the Lead's Host (`constellation.stats`,
 * C1-M, per response), with workers on other Hosts joined from those Hosts' Usage by the hour;
 * without stats, all of it estimated by the hour. Pure, so it is tested.
 */
import type { Attempt } from "@polaris/protocol";
import type { ConstellationStatsView, PricedStatsUsage } from "../../../../shared/api.ts";
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
  pricedEstimate,
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
  /** `stats`: exact per response from the Lead's Host; `hourly`: estimated from hourly buckets. */
  readonly source: "stats" | "hourly";
  /** What the figures leave out or approximate, one sentence each. */
  readonly notes: ReadonlyArray<string>;
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

/** A stats section priced like Usage: reported cost, then main's estimate for the rest. */
export const statsSpend = (usage: PricedStatsUsage): Spend =>
  usage.buckets.reduce<Spend>((sum, bucket, i) => {
    const estimate = usage.estimates[i];
    const priced: Bucket = estimate === undefined ? bucket : { ...bucket, estimate };

    return plus(sum, spendOf(priced, pricedEstimate));
  }, NONE);

type BySession = ReadonlyMap<string, ReadonlyArray<Bucket>>;

/** Hourly buckets of the given worker sessions, each to the Attempt running in that hour. */
const hourlyPerTask = (
  attempts: ReadonlyArray<Plain<Attempt>>,
  bySession: BySession,
  now: number,
  estimate: Estimator
) => {
  const perTask = new Map<string, Spend>();

  for (const sessionId of new Set(attempts.map((a): string => a.sessionId))) {
    const own = attempts.filter((a) => a.sessionId === sessionId);

    for (const b of bySession.get(sessionId) ?? []) {
      // The latest Attempt running at that hour takes it; a session carries one at a time.
      const attempt = own.findLast((a) => during(b, a, now)) ?? own.at(-1);

      if (attempt !== undefined)
        perTask.set(
          attempt.taskId,
          plus(perTask.get(attempt.taskId) ?? NONE, spendOf(b, estimate))
        );
    }
  }

  return perTask;
};

const workerAttempts = (view: ConstellationView) =>
  view.constellation.attempts.filter((a) => a.sessionId !== view.constellation.leadSessionId);

interface Parts {
  readonly lead: Spend;
  readonly perTask: ReadonlyMap<string, Spend>;
  readonly source: ConstellationSpend["source"];
  readonly notes: ReadonlyArray<string>;
  /** The Lead's Host's wall clock (stops at completion); otherwise derived from the graph. */
  readonly wallClockMs?: number;
}

const finish = (view: ConstellationView, parts: Parts, now: number): ConstellationSpend => {
  const { constellation: c } = view;

  const tasks = c.tasks
    .flatMap((t): Array<TaskSpend> => {
      const spend = parts.perTask.get(t.id);

      return spend === undefined || t.kind === "gate"
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
    lead: parts.lead,
    workers,
    total: plus(parts.lead, workers),
    tasks,
    durationMs:
      parts.wallClockMs ??
      Math.max(0, (ended ? Date.parse(c.updatedAt) : now) - Date.parse(c.createdAt)),
    source: parts.source,
    notes: parts.notes,
  };
};

/** No stats: everything from hourly buckets, Lead by session, workers by the Attempt's hours. */
const hourly = (
  view: ConstellationView,
  bySession: BySession,
  now: number,
  estimate: Estimator
) => {
  const lead = (bySession.get(view.constellation.leadSessionId) ?? []).reduce<Spend>(
    (sum, b) => plus(sum, spendOf(b, estimate)),
    NONE
  );

  return finish(
    view,
    {
      lead,
      perTask: hourlyPerTask(workerAttempts(view), bySession, now, estimate),
      source: "hourly",
      notes: ["Estimated by the hour: the lead's host has no constellation stats."],
    },
    now
  );
};

/** Stats from the Lead's Host, exact; workers on other Hosts joined by the hour. */
const fromStats = (
  view: ConstellationView,
  stats: ConstellationStatsView,
  bySession: BySession,
  now: number,
  estimate: Estimator
) => {
  const lead = stats.usage.perRole.find((r) => r.role === "lead");
  const remote = workerAttempts(view).filter((a) => a.hostId !== view.constellation.hostId);

  const perTask = new Map(
    stats.usage.perTask.map((t): [string, Spend] => [t.taskId, statsSpend(t.usage)])
  );

  for (const [taskId, spend] of hourlyPerTask(remote, bySession, now, estimate))
    perTask.set(taskId, plus(perTask.get(taskId) ?? NONE, spend));

  const reasons = stats.stats.coverage.flatMap((c) =>
    c.metric.startsWith("usage") ? [c.reason] : []
  );

  const notes = [
    ...new Set(reasons),
    ...(remote.length === 0
      ? []
      : ["Workers on other hosts are added from those hosts' usage, by the hour."]),
  ];

  return finish(
    view,
    {
      lead: lead === undefined ? NONE : statsSpend(lead.usage),
      perTask,
      source: "stats",
      notes,
      wallClockMs: stats.stats.wallClockMs,
    },
    now
  );
};

interface SpendInput {
  readonly buckets: ReadonlyArray<Bucket>;
  readonly views: ReadonlyArray<ConstellationView>;
  /** `constellation.stats` per Constellation id, when its Lead's Host answered. */
  readonly stats?: ReadonlyMap<string, ConstellationStatsView>;
  readonly now: number;
  readonly estimate?: Estimator;
}

const bySessionOf = (buckets: ReadonlyArray<Bucket>): BySession => {
  const bySession = new Map<string, Array<Bucket>>();

  for (const b of buckets) {
    if (b.sessionId === null) continue;
    const list = bySession.get(b.sessionId);

    if (list === undefined) bySession.set(b.sessionId, [b]);
    else list.push(b);
  }

  return bySession;
};

/** Every Constellation with any Usage, most tokens first. */
export const byConstellation = ({
  buckets,
  views,
  stats = new Map(),
  now,
  estimate = noEstimate,
}: SpendInput): ReadonlyArray<ConstellationSpend> => {
  const bySession = bySessionOf(buckets);

  return views
    .map((v) => {
      const own = stats.get(v.constellation.id);

      return own === undefined
        ? hourly(v, bySession, now, estimate)
        : fromStats(v, own, bySession, now, estimate);
    })
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
