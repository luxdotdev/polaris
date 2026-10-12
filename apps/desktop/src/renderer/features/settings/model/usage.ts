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

export const NO_COST: Cost = { usd: 0, estimated: false, partial: false };

export const bucketCost = (bucket: Bucket, estimate: Estimator): Cost => {
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

export const addCost = (a: Cost, b: Cost): Cost => ({
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
  /** `YYYY-MM-DD`, local. */
  readonly date: string;
  /** In `harnesses` order; every Harness present, zero when idle. */
  readonly series: ReadonlyArray<HarnessDay>;
  readonly total: number;
  /** The day's Models, most tokens first: the chart's tooltip. */
  readonly models: ReadonlyArray<ModelRow>;
  /** The same Models split by whether they ran in an Agent Session, for the split tooltip. */
  readonly polarisModels: ReadonlyArray<ModelRow>;
  readonly outsideModels: ReadonlyArray<ModelRow>;
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

const pad = (n: number) => String(n).padStart(2, "0");

const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A bucket's local day, by the hour it starts; a half-hour zone puts a straddling hour in its first day. */
const dayOf = (iso: string) => localDate(new Date(iso));

/** Local midnight `back` calendar days before `now`'s day; DST-safe, unlike subtracting 24h. */
const midnightBefore = (now: number, back: number) => {
  const d = new Date(now);

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
};

/** The local days in the range, oldest first, ending today. */
export const rangeDays = (days: RangeDays, now: number): ReadonlyArray<string> =>
  Array.from({ length: days }, (_, i) => localDate(midnightBefore(now, days - 1 - i)));

/** The query window for a range: from local midnight of its first day to now. */
export const rangeWindow = (days: RangeDays, now: number) => ({
  from: midnightBefore(now, days - 1).toISOString(),
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

    const all = byDay.get(date) ?? [];
    const models = modelRows(all, estimate);

    return {
      date,
      series,
      total: series.reduce((n, s) => n + s.polaris + s.outside, 0),
      models,
      polarisModels: modelRows(
        all.filter((b) => b.sessionId !== null),
        estimate
      ),
      outsideModels: modelRows(
        all.filter((b) => b.sessionId === null),
        estimate
      ),
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
  /** Ran outside Polaris while the split is on: drawn dimmed, under the Polaris subtotal. */
  readonly outside: boolean;
}

export interface DayTip {
  readonly date: string;
  readonly rows: ReadonlyArray<DayTipRow>;
  /** With the split on and usage both in and outside Polaris: the Polaris rows' total. */
  readonly polaris: { readonly tokens: string; readonly cost: string } | null;
  readonly tokens: string;
  readonly cost: string;
}

const tipRows = (models: ReadonlyArray<ModelRow>, outside: boolean): Array<DayTipRow> =>
  models.map((m) => ({
    key: `${m.harness}/${m.model}${outside ? "/outside" : ""}`,
    model: m.model,
    harness: m.harness,
    tokens: compactTokens(m.tokens),
    cost: tipCost(m.cost),
    outside,
  }));

const subtotal = (models: ReadonlyArray<ModelRow>) => ({
  tokens: compactTokens(models.reduce((n, m) => n + m.tokens, 0)),
  cost: tipCost(models.reduce((c, m) => addCost(c, m.cost), NO_COST)),
});

/**
 * The chart's tooltip for one day: each Model with its tokens and cost, then the day's total.
 * Split, Polaris rows come first with their subtotal, then the rest dimmed.
 */
export const dayTip = (day: Day, split = false): DayTip => {
  const both = day.polarisModels.length > 0 && day.outsideModels.length > 0;

  return {
    date: day.date,
    rows: split
      ? [...tipRows(day.polarisModels, false), ...tipRows(day.outsideModels, true)]
      : tipRows(day.models, false),
    polaris: split && both ? subtotal(day.polarisModels) : null,
    tokens: compactTokens(day.total),
    cost: day.total === 0 ? "" : tipCost(day.cost),
  };
};

/**
 * The share in Polaris sessions as a figure: a share that rounds to 0% or 100%
 * without being either reads "<1%" or ">99%", so a little is never "none".
 */
export const formatShare = (share: number | null): string => {
  if (share === null) return "—";
  const percent = Math.round(share * 100);

  if (percent === 0 && share > 0) return "<1%";

  if (percent === 100 && share < 1) return ">99%";

  return `${percent}%`;
};

/** Below this share, splitting would draw every bar at the faint outside-Polaris tint. */
export const SPLIT_FROM_SHARE = 0.01;

/** The split starts on only when there is Polaris Usage to set apart. */
export const splitByDefault = (share: number | null): boolean =>
  share !== null && share >= SPLIT_FROM_SHARE;
