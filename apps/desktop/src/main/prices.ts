/**
 * The price table Usage estimates come from (`@polaris/client/usage`, ENG-207):
 * the cached fetch, else the bundled snapshot, refreshed when a day old. Main
 * prices each bucket, since the price book reads and writes files.
 */
import { join } from "node:path";
import { bucketCost, PriceBook, type PriceTable } from "@polaris/client/usage";
import type { UsageBucket } from "@polaris/protocol";
import { ManagedRuntime } from "effect";
import type { BucketEstimate } from "../shared/api.ts";

/** Ask the book at most this often; it refetches only when its table is a day old. */
const CHECK_MS = 3_600_000;

export interface Prices {
  readonly table: () => Promise<PriceTable>;
}

export const openPrices = (userData: string): Prices => {
  const runtime = ManagedRuntime.make(
    PriceBook.layer({ cacheFile: join(userData, "prices.json") })
  );

  let current: { at: number; table: Promise<PriceTable> } | null = null;

  return {
    table: () => {
      if (current === null || Date.now() - current.at > CHECK_MS) {
        current = {
          at: Date.now(),
          table: runtime.runPromise(PriceBook.use((book) => book.refreshIfStale)),
        };
      }

      return current.table;
    },
  };
};

/** Each bucket's estimate, in order. */
export const estimate = (
  buckets: ReadonlyArray<UsageBucket>,
  table: PriceTable
): ReadonlyArray<BucketEstimate> =>
  buckets.map((b) => {
    const cost = bucketCost(b, table);

    return { estimatedUsd: cost.estimatedUsd, unpricedTokens: cost.unpricedTokens };
  });
