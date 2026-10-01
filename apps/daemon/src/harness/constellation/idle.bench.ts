import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startSampler } from "../../../../../packages/bench/src/sampler.ts";

const samples = [];

for (let run = 0; run < 3; run++) {
  for (const workers of [0, 128]) {
    const home = mkdtempSync("/tmp/polaris-mcp-idle-");

    const child = Bun.spawn(
      ["bun", join(import.meta.dir, "../../mcp/idle.fixture.ts"), String(workers)],
      { env: { ...process.env, POLARIS_HOME: home }, stdout: "pipe", stderr: "pipe" }
    );

    const reader = child.stdout.getReader();
    const sampler = startSampler({ roots: () => [child.pid], intervalMs: 500 });

    try {
      const ready = await reader.read();

      if (!new TextDecoder().decode(ready.value).includes("ready"))
        throw new Error("Idle fixture failed to start");
      await Bun.sleep(2000);
      const from = sampler.sample().t;
      await Bun.sleep(10000);
      const report = sampler.report(from - 1, sampler.sample().t);
      samples.push({
        run,
        workers,
        cpuAvgPct: report.cpuAvgPct,
        wakeupsPerSec: report.wakeupsPerSec,
        rssMiB: report.rssBytes.median / 1048576,
        processes: report.maxProcesses,
      });
    } finally {
      sampler.stop();
      reader.releaseLock();
      child.kill();
      await child.exited;
      rmSync(home, { recursive: true, force: true });
    }
  }
}

console.log(JSON.stringify(samples, null, 2));
