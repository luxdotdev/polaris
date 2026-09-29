/**
 * cold-start: spawn → first successful `hello` on the socket, the Daemon's
 * memory once settled, and how long a Client takes to connect through
 * `polaris bridge` to a running Daemon.
 */
import { Effect } from "effect";
import { awaitReady, connect } from "../daemon.ts";
import { settle } from "../drive.ts";
import { summarize } from "../stats.ts";
import { cpu, type Metric, memory, type Scenario, time } from "../types.ts";

export const coldStart: Scenario = {
  name: "cold-start",
  description: "spawn → first hello; RSS after settle; bridge connect time",
  run: (ctx) =>
    Effect.gen(function* () {
      const spawns = ctx.quick ? 3 : 5;
      const hello: Array<number> = [];
      const rss: Array<number> = [];
      const footprint: Array<number> = [];
      const bridge: Array<number> = [];
      let idleCpu = 0;

      for (let i = 0; i < spawns; i++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const daemon = yield* ctx.launch();
            const sampler = yield* ctx.sample(daemon, 100);
            hello.push(yield* awaitReady(daemon));
            const ready = sampler.now();
            yield* settle(2000);
            const s = sampler.sample();
            rss.push(s.rssBytes);

            if (s.footprintBytes !== null) footprint.push(s.footprintBytes);
            const t0 = performance.now();
            yield* Effect.scoped(connect(daemon, "bridge"));
            bridge.push(performance.now() - t0);

            // CPU in the settled window, before the bridge connect.
            if (i === 0) idleCpu = sampler.report(ready + 500, ready + 2000).cpuAvgPct;
          })
        );
      }

      const metrics: Record<string, Metric> = {};

      Object.assign(metrics, {
        hello_ms: time(summarize(hello).median),
        hello_max_ms: time(summarize(hello).max, { info: true }),
        rss_settled_mib: memory(summarize(rss).median),
      } satisfies Record<string, Metric>);

      if (footprint.length > 0) {
        metrics.footprint_settled_mib = memory(summarize(footprint).median);
      }

      metrics.bridge_connect_ms = time(summarize(bridge).median);
      metrics.settle_cpu_pct = cpu(idleCpu, { info: true });

      return {
        metrics,
        notes: [`${spawns} spawns per run; hello polled every 2 ms over the Unix socket`],
      };
    }),
};
