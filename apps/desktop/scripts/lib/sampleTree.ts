#!/usr/bin/env bun
/**
 * Samples process trees for `ms` and prints one JSON line per group:
 * `{ label, rssMiB, footprintMiB, processes }` (peaks over the window).
 * Runs under Bun (the sampler reads macOS counters through bun:ffi), called
 * from Node scripts such as `budgets.ts`:
 *
 *   bun scripts/lib/sampleTree.ts <ms> <label>=<pid>[,<pid>…] …
 */
import { startSampler } from "@polaris/bench/sampler";

const [msArg = "3000", ...groups] = process.argv.slice(2);

const MiB = 1024 * 1024;

const samplers = groups.map((group) => {
  const [label = "", pids = ""] = group.split("=");

  const roots = pids
    .split(",")
    .map(Number)
    .filter((pid) => pid > 0);

  return { label, sampler: startSampler({ roots: () => roots, intervalMs: 200 }) };
});

await Bun.sleep(Number(msArg));

for (const { label, sampler } of samplers) {
  const report = sampler.report();
  sampler.stop();

  console.log(
    JSON.stringify({
      label,
      rssMiB: report.rssBytes.max / MiB,
      footprintMiB: report.footprintBytes === null ? null : report.footprintBytes.max / MiB,
      processes: report.maxProcesses,
    })
  );
}
