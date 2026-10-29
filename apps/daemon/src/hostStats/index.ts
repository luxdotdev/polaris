/** Host stats (ENG-565): `host.stats.watch`, sampled only while a Client watches. */
import { HostStatsRpcs } from "@polaris/protocol";
import { Effect } from "effect";
import { HostStats } from "./HostStats.ts";

export { HOST_STATS_INTERVAL_MS, HostStats, type HostStatsOptions } from "./HostStats.ts";

export type { CpuTimes, HostProbe, HostReading } from "./probe.ts";

/** Requires `HostStats`. */
export const HostStatsRpcsLive = HostStatsRpcs.toLayer(
  Effect.gen(function* () {
    const stats = yield* HostStats;

    return { "host.stats.watch": () => stats.watch };
  })
);
