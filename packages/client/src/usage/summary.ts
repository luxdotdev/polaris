/**
 * Usage across Hosts, as the Usage view shows it: totals by Harness, Model,
 * Host and local day, and the share that went through Polaris. Costs are
 * API-equivalent estimates, labelled with when their prices were fetched.
 */
import { addTokens, noTokens, type TokenCounts, type UsageBucket } from "@polaris/protocol";
import { bucketCost } from "./cost.ts";
import type { PriceTable } from "./prices.ts";

export interface UsageCost {
  /** Reported plus estimated, USD. What the Usage would cost at API prices, not money spent. */
  readonly usd: number;
  readonly reportedUsd: number;
  readonly estimatedUsd: number;
  /** Tokens with no price in any list; not in `usd`. */
  readonly unpricedTokens: number;
}

export interface UsageTotal {
  readonly tokens: TokenCounts;
  readonly cost: UsageCost;
  /** Models in this total that no price list has. */
  readonly unpricedModels: ReadonlyArray<string>;
}

export interface HostUsage {
  /** The Host's key, as the Client's `HostRegistry` names it. */
  readonly host: string;
  readonly buckets: ReadonlyArray<UsageBucket>;
}

export interface UsageSummary {
  readonly total: UsageTotal;
  /** The part that ran in Agent Sessions; the rest is Harness work outside Polaris. */
  readonly polaris: UsageTotal;
  readonly byHarness: ReadonlyArray<{ readonly harness: string; readonly total: UsageTotal }>;
  readonly byModel: ReadonlyArray<{
    readonly harness: string;
    readonly model: string;
    readonly total: UsageTotal;
  }>;
  readonly byHost: ReadonlyArray<{ readonly host: string; readonly total: UsageTotal }>;
  /** Local days (`YYYY-MM-DD` in `timeZone`), oldest first. */
  readonly byDay: ReadonlyArray<{ readonly day: string; readonly total: UsageTotal }>;
  /** Every cost here is an estimate from prices fetched at this time. */
  readonly pricesFetchedAt: string;
}

class Sum {
  tokens: TokenCounts = noTokens;
  usd = 0;
  reportedUsd = 0;
  estimatedUsd = 0;
  unpricedTokens = 0;
  readonly unpriced = new Set<string>();

  add(bucket: UsageBucket, cost: ReturnType<typeof bucketCost>) {
    this.tokens = addTokens(this.tokens, bucket.tokens);
    this.usd += cost.usd;
    this.reportedUsd += cost.reportedUsd;
    this.estimatedUsd += cost.estimatedUsd;
    this.unpricedTokens += cost.unpricedTokens;

    if (cost.unpricedTokens > 0) this.unpriced.add(bucket.model);
  }

  total(): UsageTotal {
    return {
      tokens: this.tokens,
      cost: {
        usd: this.usd,
        reportedUsd: this.reportedUsd,
        estimatedUsd: this.estimatedUsd,
        unpricedTokens: this.unpricedTokens,
      },
      unpricedModels: [...this.unpriced].sort(),
    };
  }
}

const sumIn = <K>(map: Map<K, Sum>, key: K) => {
  const existing = map.get(key);

  if (existing) return existing;
  const created = new Sum();
  map.set(key, created);

  return created;
};

/** The local day an hourly bucket starts in. A bucket straddling midnight (a :30 offset) counts for its start. */
export const localDay = (format: Intl.DateTimeFormat, hour: string) => {
  const parts = format.formatToParts(new Date(hour));

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
};

const MODEL_KEY = "\u0000";

export const summarizeUsage = (options: {
  readonly hosts: ReadonlyArray<HostUsage>;
  readonly prices: PriceTable;
  /** An IANA zone, e.g. `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  readonly timeZone: string;
}): UsageSummary => {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const total = new Sum();
  const polaris = new Sum();
  const harnesses = new Map<string, Sum>();
  const models = new Map<string, Sum>();
  const hosts = new Map<string, Sum>();
  const days = new Map<string, Sum>();

  for (const { host, buckets } of options.hosts) {
    for (const bucket of buckets) {
      const cost = bucketCost(bucket, options.prices);
      total.add(bucket, cost);

      if (bucket.sessionId !== null) polaris.add(bucket, cost);
      sumIn(harnesses, bucket.harness).add(bucket, cost);
      sumIn(models, `${bucket.harness}${MODEL_KEY}${bucket.model}`).add(bucket, cost);
      sumIn(hosts, host).add(bucket, cost);
      sumIn(days, localDay(format, bucket.hour)).add(bucket, cost);
    }
  }

  const byCost = <T extends { total: UsageTotal }>(rows: Array<T>) =>
    rows.sort((a, b) => b.total.cost.usd - a.total.cost.usd);

  return {
    total: total.total(),
    polaris: polaris.total(),
    byHarness: byCost([...harnesses].map(([harness, sum]) => ({ harness, total: sum.total() }))),
    byModel: byCost(
      [...models].map(([key, sum]) => {
        const [harness = "", model = ""] = key.split(MODEL_KEY);

        return { harness, model, total: sum.total() };
      })
    ),
    byHost: byCost([...hosts].map(([host, sum]) => ({ host, total: sum.total() }))),
    byDay: [...days]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, sum]) => ({ day, total: sum.total() })),
    pricesFetchedAt: options.prices.fetchedAt,
  };
};
