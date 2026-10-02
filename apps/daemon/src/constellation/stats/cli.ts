import { connectRpc, socketTransport } from "@polaris/client";
import { bundledPrices, summarizeUsage } from "@polaris/client/usage";
import { ConstellationId, ConstellationStats, type StatsUsage } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { paths } from "../../paths.ts";

/** The CLI is a Client: only it estimates cost; the Daemon never fetches prices. */
export const pricedStats = (stats: ConstellationStats) => {
  const prices = bundledPrices();

  const cost = (usage: StatsUsage) =>
    summarizeUsage({
      hosts: [{ host: stats.hostId, buckets: usage.buckets }],
      prices,
      timeZone: "UTC",
    }).total.cost;

  const digestCosts = stats.lead.digests.map((d) => ({ turnId: d.turnId, cost: cost(d.usage) }));

  return {
    ...Schema.encodeSync(ConstellationStats)(stats),
    pricing: {
      kind: "api-equivalent-estimate",
      pricesFetchedAt: prices.fetchedAt,
      source: "bundled",
    },
    cost: {
      total: cost(stats.usage.total),
      perTask: stats.usage.perTask.map((t) => ({ taskId: t.taskId, cost: cost(t.usage) })),
      perRole: stats.usage.perRole.map((r) => ({ role: r.role, cost: cost(r.usage) })),
      perDigest: digestCosts,
      meanUsdPerDigest:
        stats.lead.meanTokensPerDigest === null || digestCosts.length === 0
          ? null
          : digestCosts.reduce((n, d) => n + d.cost.usd, 0) / digestCosts.length,
    },
  };
};

export const runConstellationStats = async (args: ReadonlyArray<string>): Promise<number> => {
  const [verb, id, ...flags] = args;

  if (verb !== "stats" || id === undefined || flags.some((f) => f !== "--json")) {
    console.error("usage: polaris constellation stats <id> --json");

    return 2;
  }

  try {
    const stats = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* socketTransport(
            process.env.POLARIS_HOST_SOCKET ?? paths().socket
          );

          const { client } = yield* connectRpc(transport);

          return yield* client["constellation.stats"]({
            constellationId: ConstellationId.make(id),
          });
        })
      ).pipe(Effect.timeout("30 seconds"))
    );

    console.log(JSON.stringify(pricedStats(stats), null, 2));

    return 0;
  } catch (error) {
    console.error(`polaris constellation stats: ${String(error)}`);

    return 1;
  }
};
