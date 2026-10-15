/**
 * The price table Usage estimates come from (`@polaris/client/usage`, ENG-207):
 * the cached fetch, else the bundled snapshot, refreshed when a day old, fetched
 * through Chromium (`net.ts`). Main prices each bucket (`estimate.ts`).
 */
import { join } from "node:path";
import { PriceBook, type PriceTable, textFetcher } from "@polaris/client/usage";
import { ManagedRuntime } from "effect";
import { internetFetch } from "./net.ts";

/** Ask the book at most this often; it refetches only when its table is a day old. */
const CHECK_MS = 3_600_000;

export interface Prices {
  readonly table: () => Promise<PriceTable>;
}

export const openPrices = (userData: string): Prices => {
  const runtime = ManagedRuntime.make(
    PriceBook.layer({
      cacheFile: join(userData, "prices.json"),
      fetchText: textFetcher(internetFetch),
    })
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
