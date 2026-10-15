/** Each Usage bucket priced against the table `prices.ts` keeps (ENG-207). */
import { bucketCost, type PriceTable } from "@polaris/client/usage";
import type { UsageBucket } from "@polaris/protocol";
import type { BucketEstimate } from "../shared/api.ts";

/** Each bucket's estimate, in order. */
export const estimate = (
  buckets: ReadonlyArray<UsageBucket>,
  table: PriceTable
): ReadonlyArray<BucketEstimate> =>
  buckets.map((b) => {
    const cost = bucketCost(b, table);

    return { estimatedUsd: cost.estimatedUsd, unpricedTokens: cost.unpricedTokens };
  });
