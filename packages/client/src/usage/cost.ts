/**
 * What a Usage bucket would cost at API prices. A cost the Harness reported
 * wins for the tokens it covers; the rest is estimated from the price table,
 * and a Model no list prices is left unpriced rather than guessed.
 */
import { noTokens, TokenCounts, type UsageBucket } from "@polaris/protocol";
import { type PriceTable, type Rates, resolvePrice } from "./prices.ts";

export interface BucketCost {
  /** Reported plus estimated, in USD. Subscription Usage is API-equivalent, never money spent. */
  readonly usd: number;
  /** The part the Harness reported itself. */
  readonly reportedUsd: number;
  /** The part estimated from the price table. */
  readonly estimatedUsd: number;
  /** Tokens left out of `usd` because no price list has their Model. */
  readonly unpricedTokens: number;
}

/** Tokens as a price list bills them: every kind, reasoning inside output. */
export const billedTokens = (t: TokenCounts) => t.input + t.cacheRead + t.cacheWrite + t.output;

const minus = (a: TokenCounts, b: TokenCounts) =>
  new TokenCounts({
    input: Math.max(0, a.input - b.input),
    cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
    cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
    output: Math.max(0, a.output - b.output),
    reasoning: Math.max(0, a.reasoning - b.reasoning),
    cacheWrite1h: Math.max(0, a.cacheWrite1h - b.cacheWrite1h),
  });

const least = (a: TokenCounts, b: TokenCounts) =>
  new TokenCounts({
    input: Math.min(a.input, b.input),
    cacheRead: Math.min(a.cacheRead, b.cacheRead),
    cacheWrite: Math.min(a.cacheWrite, b.cacheWrite),
    output: Math.min(a.output, b.output),
    reasoning: Math.min(a.reasoning, b.reasoning),
    cacheWrite1h: Math.min(a.cacheWrite1h, b.cacheWrite1h),
  });

/** `t` at `rates`: five-minute and one-hour cache writes priced apart. */
export const priceTokens = (t: TokenCounts, rates: Rates): number => {
  const hour = Math.min(t.cacheWrite1h, t.cacheWrite);

  return (
    t.input * rates.input +
    t.output * rates.output +
    t.cacheRead * rates.cacheRead +
    (t.cacheWrite - hour) * rates.cacheWrite +
    hour * rates.cacheWrite1h
  );
};

export const bucketCost = (bucket: UsageBucket, table: PriceTable): BucketCost => {
  const reportedUsd = bucket.reportedCost?.usd ?? 0;
  const uncovered = minus(bucket.tokens, bucket.reportedCost?.tokens ?? noTokens);
  const price = resolvePrice(table, bucket.model);

  if (price === null)
    return {
      usd: reportedUsd,
      reportedUsd,
      estimatedUsd: 0,
      unpricedTokens: billedTokens(uncovered),
    };

  // The Daemon counts long requests per threshold; a Model with another threshold is priced flat.
  const tier = price.longContext;
  const long = tier && bucket.longContext.find((l) => l.above === tier.above);
  const longTokens = long ? least(long.tokens, uncovered) : noTokens;

  const estimatedUsd =
    priceTokens(minus(uncovered, longTokens), price.rates) +
    (tier ? priceTokens(longTokens, tier.rates) : 0);

  return { usd: reportedUsd + estimatedUsd, reportedUsd, estimatedUsd, unpricedTokens: 0 };
};
