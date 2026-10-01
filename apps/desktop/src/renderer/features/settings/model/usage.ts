/**
 * Settings → Usage as data (DESIGN.md, Settings; Paper S2): totals, the share
 * run in Polaris sessions, a daily series per Harness and a by-model table
 * over every Host's buckets. Cost is what the Harness reported; anything else
 * needs an estimate from a price list (ENG-207), passed in as `estimate`.
 */
import type { TokenCounts, UsageBucket } from "@polaris/protocol";
import type { BucketEstimate, Plain } from "../../../../shared/api.ts";

/** A bucket as `usage.query` returns it, with main's API-price estimate when it has one. */
export type Bucket = Plain<UsageBucket> & { readonly estimate?: BucketEstimate };

export type Tokens = Plain<TokenCounts>;

/** An API-equivalent USD estimate for a bucket's tokens not covered by a reported cost; null if unpriced. */
export type Estimator = (bucket: Bucket, tokens: Tokens) => number | null;

export const RANGES = [7, 30, 90] as const;

export type RangeDays = (typeof RANGES)[number];

const DAY_MS = 86_400_000;

export const totalTokens = (t: Tokens): number => t.input + t.cacheRead + t.cacheWrite + t.output;

const minus = (a: Tokens, b: Tokens): Tokens => ({
  input: Math.max(0, a.input - b.input),
  cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
  cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
  output: Math.max(0, a.output - b.output),
  reasoning: Math.max(0, a.reasoning - b.reasoning),
  cacheWrite1h: Math.max(0, a.cacheWrite1h - b.cacheWrite1h),
});

/** A cost: exact when the Harness reported all of it, estimated when any part is priced by us. */
export interface Cost {
  readonly usd: number;
  readonly estimated: boolean;
  /** Some tokens had neither a reported cost nor a price. */
  readonly partial: boolean;
}

const NO_COST: Cost = { usd: 0, estimated: false, partial: false };

const bucketCost = (bucket: Bucket, estimate: Estimator): Cost => {
  const reported = bucket.reportedCost;
  const rest = reported === null ? bucket.tokens : minus(bucket.tokens, reported.tokens);
  const uncovered = totalTokens(rest) > 0;
  const priced = uncovered ? estimate(bucket, rest) : 0;

  return {
    usd: (reported?.usd ?? 0) + (priced ?? 0),
    estimated: uncovered && priced !== null,
    partial: uncovered && priced === null,
  };
};

const addCost = (a: Cost, b: Cost): Cost => ({
  usd: a.usd + b.usd,
  estimated: a.estimated || b.estimated,
  partial: a.partial || b.partial,
});

export const noEstimate: Estimator = () => null;

/** Main's estimate from the price book (ENG-207); a bucket with unpriced tokens stays unpriced. */
export const pricedEstimate: Estimator = (bucket) =>
  bucket.estimate === undefined || bucket.estimate.unpricedTokens > 0
    ? null
    : bucket.estimate.estimatedUsd;

export interface HarnessDay {
  readonly harness: string;
  readonly polaris: number;
  readonly outside: number;
}

export interface Day {
  /** `YYYY-MM-DD`, UTC. */
  readonly date: string;
  /** In `harnesses` order; every Harness present, zero when idle. */
  readonly series: ReadonlyArray<HarnessDay>;
  readonly total: number;
  /** The day's Models, most tokens first: the chart's tooltip. */
  readonly models: ReadonlyArray<ModelRow>;
  readonly cost: Cost;
}

export interface ModelRow {
  readonly model: string;
  readonly harness: string;
  readonly tokens: number;
  readonly cost: Cost;
}

export interface UsageSummary {
  readonly tokens: number;
  readonly cost: Cost;
  /** 0–1 of tokens in Agent Sessions; null with no tokens. */
  readonly polarisShare: number | null;
  /** Harnesses with any tokens, most first. */
  readonly harnesses: ReadonlyArray<string>;
  readonly days: ReadonlyArray<Day>;
  readonly byModel: ReadonlyArray<ModelRow>;
}

const dayOf = (iso: string) => iso.slice(0, 10);

/** The UTC days in the range, oldest first, ending today. */
export const rangeDays = (days: RangeDays, now: number): ReadonlyArray<string> =>
  Array.from({ length: days }, (_, i) =>
    new Date(now - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );

/** The query window for a range: from the start of its first UTC day to now. */
export const rangeWindow = (days: RangeDays, now: number) => ({
  from: `${rangeDays(days, now)[0]}T00:00:00.000Z`,
  to: new Date(now).toISOString(),
});

const byTokens = <K>(totals: Map<K, number>) =>
  [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

const bump = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);

const dailySeries = (
  buckets: ReadonlyArray<Bucket>,
  dates: ReadonlyArray<string>,
  harnesses: ReadonlyArray<string>,
  estimate: Estimator
): ReadonlyArray<Day> => {
  const cells = new Map<string, number>();
  const byDay = new Map<string, Array<Bucket>>();

  for (const b of buckets) {
    const date = dayOf(b.hour);
    const list = byDay.get(date);

    if (list === undefined) byDay.set(date, [b]);
    else list.push(b);
    bump(
      cells,
      `${dayOf(b.hour)}|${b.harness}|${b.sessionId === null ? "out" : "in"}`,
      totalTokens(b.tokens)
    );
  }

  return dates.map((date) => {
    const series = harnesses.map((harness) => ({
      harness,
      polaris: cells.get(`${date}|${harness}|in`) ?? 0,
      outside: cells.get(`${date}|${harness}|out`) ?? 0,
    }));

    const models = modelRows(byDay.get(date) ?? [], estimate);

    return {
      date,
      series,
      total: series.reduce((n, s) => n + s.polaris + s.outside, 0),
      models,
      cost: models.reduce((c, m) => addCost(c, m.cost), NO_COST),
    };
  });
};

const modelRows = (
  buckets: ReadonlyArray<Bucket>,
  estimate: Estimator
): ReadonlyArray<ModelRow> => {
  const rows = new Map<string, { model: string; harness: string; tokens: number; cost: Cost }>();

  for (const b of buckets) {
    const key = `${b.harness}\u0000${b.model}`;
    const row = rows.get(key) ?? { model: b.model, harness: b.harness, tokens: 0, cost: NO_COST };

    rows.set(key, {
      ...row,
      tokens: row.tokens + totalTokens(b.tokens),
      cost: addCost(row.cost, bucketCost(b, estimate)),
    });
  }

  return [...rows.values()].sort((a, b) => b.tokens - a.tokens);
};

export interface SummaryInput {
  readonly buckets: ReadonlyArray<Bucket>;
  readonly days: RangeDays;
  readonly now: number;
  readonly estimate?: Estimator;
}

export const usageSummary = ({
  buckets: all,
  days,
  now,
  estimate = noEstimate,
}: SummaryInput): UsageSummary => {
  const dates = rangeDays(days, now);
  const first = dates[0] ?? "";
  const buckets = all.filter((b) => dayOf(b.hour) >= first);
  const perHarness = new Map<string, number>();
  let tokens = 0;
  let inPolaris = 0;
  let cost = NO_COST;

  for (const b of buckets) {
    const n = totalTokens(b.tokens);

    tokens += n;
    inPolaris += b.sessionId === null ? 0 : n;
    cost = addCost(cost, bucketCost(b, estimate));
    bump(perHarness, b.harness, n);
  }

  const harnesses = byTokens(perHarness);

  return {
    tokens,
    cost,
    polarisShare: tokens === 0 ? null : inPolaris / tokens,
    harnesses,
    days: dailySeries(buckets, dates, harnesses, estimate),
    byModel: modelRows(buckets, estimate),
  };
};

/** "48.2M", "912K", "640". */
export const compactTokens = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;

  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;

  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;

  return String(n);
};

/** "$312.40", with "~" when any of it is estimated (DESIGN.md, Settings). */
export const costLabel = (cost: Cost): string => {
  if (cost.usd === 0 && cost.partial) return "—";
  const usd = `$${cost.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return cost.estimated ? `~${usd}` : usd;
};

/** The cost figure's caption (Paper S2): what the number is, and whether some Models had no price. */
export const costCaption = (cost: Cost): string => {
  const what = cost.estimated ? "API-equivalent · estimated" : "Reported by harnesses";

  return cost.partial ? `${what} · some models unpriced` : what;
};

/** A tooltip's cost: "~$1.20" estimated, "$1.20" reported, "no price" when nothing could price it. */
export const tipCost = (cost: Cost): string => {
  if (cost.usd === 0 && cost.partial) return "no price";

  return cost.partial ? `${costLabel(cost)} + no price` : costLabel(cost);
};

export interface DayTipRow {
  readonly key: string;
  readonly model: string;
  readonly harness: string;
  readonly tokens: string;
  readonly cost: string;
}

export interface DayTip {
  readonly date: string;
  readonly rows: ReadonlyArray<DayTipRow>;
  readonly tokens: string;
  readonly cost: string;
}

/** The chart's tooltip for one day: each Model with its tokens and cost, then the day's total. */
export const dayTip = (day: Day): DayTip => ({
  date: day.date,
  rows: day.models.map((m) => ({
    key: `${m.harness}/${m.model}`,
    model: m.model,
    harness: m.harness,
    tokens: compactTokens(m.tokens),
    cost: tipCost(m.cost),
  })),
  tokens: compactTokens(day.total),
  cost: day.total === 0 ? "" : tipCost(day.cost),
});
