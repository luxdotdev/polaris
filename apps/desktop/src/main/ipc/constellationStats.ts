/**
 * `constellation.stats` for the renderer: C1-M's metrics with each Usage bucket priced by this
 * Mac's price table, as `usage.query` does, so Usage → By constellation costs match the rest.
 */
import type { ConstellationStats, StatsUsage } from "@polaris/protocol";
import type { ConstellationStatsView, PricedStatsUsage } from "../../shared/api.ts";
import type { PriceTable } from "@polaris/client/usage";
import { estimate } from "../prices.ts";

const priced = (usage: StatsUsage, table: PriceTable | null): PricedStatsUsage => ({
  ...usage,
  estimates: table === null ? [] : estimate(usage.buckets, table),
});

export const pricedStats = (
  stats: ConstellationStats,
  table: PriceTable | null
): ConstellationStatsView => ({
  stats,
  usage: {
    total: priced(stats.usage.total, table),
    perTask: stats.usage.perTask.map((t) => ({ taskId: t.taskId, usage: priced(t.usage, table) })),
    perRole: stats.usage.perRole.map((r) => ({ role: r.role, usage: priced(r.usage, table) })),
    perDigest: stats.lead.digests.map((d) => priced(d.usage, table)),
  },
  pricesFetchedAt: table?.fetchedAt ?? null,
});
