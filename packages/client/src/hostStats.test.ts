import { expect, test } from "bun:test";
import { HOST_STATS_HISTORY, HostStatsItem, HostStatsSample } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import {
  applyHostStats,
  emptyHostStats,
  type HostStatsSession,
  watchHostStats,
} from "./hostStats.ts";

const sample = (n: number) =>
  new HostStatsSample({
    at: new Date(n * 2000).toISOString(),
    cpuPercent: n % 100,
    loadAverage: null,
    memoryUsedBytes: n,
    memoryTotalBytes: 1000,
    disk: null,
  });

test("a Daemon without host.stats is never asked, and the feed ends empty", async () => {
  const session: HostStatsSession = {
    capabilities: ["usage", "presence"],
    client: { "host.stats.watch": () => Stream.die("an older Daemon was asked for host stats") },
  };

  expect(await Effect.runPromise(Stream.runCollect(watchHostStats(session)))).toEqual([]);
});

test("the window slides at HOST_STATS_HISTORY and a new History replaces it", () => {
  const history = HostStatsItem.cases.History.make({
    cores: 4,
    intervalMs: 2000,
    samples: [sample(0), sample(1)],
  });

  const live = Array.from({ length: HOST_STATS_HISTORY }, (_, i) =>
    HostStatsItem.cases.Sample.make({ sample: sample(i + 2) })
  );

  const window = [history, ...live].reduce(applyHostStats, emptyHostStats);

  expect(window.samples).toHaveLength(HOST_STATS_HISTORY);
  expect(window.samples[0]).toEqual(sample(2));
  expect(window.samples.at(-1)).toEqual(sample(HOST_STATS_HISTORY + 1));

  const resubscribed = applyHostStats(
    window,
    HostStatsItem.cases.History.make({ cores: 8, intervalMs: 2000, samples: [sample(99)] })
  );

  expect(resubscribed).toEqual({ cores: 8, intervalMs: 2000, samples: [sample(99)] });
});
