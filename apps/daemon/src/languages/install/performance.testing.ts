import { loadavg } from "node:os";
import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { artifactFixture, fixture } from "./fixture.testing.ts";

async function retainedBytes(directory: string) {
  let total = 0;
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  for (const entry of entries)
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size;

  return total;
}

async function sample() {
  const controlCpuStart = process.cpuUsage();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  const controlCpu = process.cpuUsage(controlCpuStart);
  const baselineMemory = process.memoryUsage();
  const baselineCpu = process.cpuUsage();
  let source = artifactFixture();
  let downloads = 0;
  const start = performance.now();

  const f = await fixture({
    async *download() {
      downloads++;
      yield source.bytes;
    },
    async decode() {
      return source.payload;
    },
  });

  const constructMs = performance.now() - start;

  try {
    const first = performance.now();
    const requests = Array.from({ length: 32 }, () => f.installer.install(f.request));
    const installed = await Promise.all(requests.map((request) => request.result));
    const contentionMs = performance.now() - first;

    if (new Set(installed.map((version) => version.identity)).size !== 1 || downloads !== 1)
      throw new Error("dedup failed");
    const cache = performance.now();

    for (let index = 0; index < 10; index++) await f.installer.install(f.request).result;
    const cacheMs = (performance.now() - cache) / 10;
    const update = performance.now();
    source = artifactFixture("2.0.0");
    await f.installer.install({ ...f.request, tool: source.tool, intent: "update" }).result;
    const updateMs = performance.now() - update;
    const idleStart = process.cpuUsage();
    const idleRss = process.memoryUsage().rss;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const idleCpu = process.cpuUsage(idleStart);

    if ((await f.debris()).length || f.installer.stats().jobs || f.installer.stats().waiters)
      throw new Error("cleanup failed");
    const retained = await retainedBytes(join(f.parent, "private"));
    const endMemory = process.memoryUsage();

    return {
      constructMs,
      contention32Ms: contentionMs,
      installedRecheckMeanMs: cacheMs,
      controlIdleCpuUs: controlCpu.user + controlCpu.system,
      updateMs,
      downloads,
      retainedBytes: retained,
      ownDebris: 0,
      idleCpuUs: idleCpu.user + idleCpu.system,
      idleRss,
      rssDelta: endMemory.rss - baselineMemory.rss,
      heapDelta: endMemory.heapUsed - baselineMemory.heapUsed,
      cpu: process.cpuUsage(baselineCpu),
      stats: f.installer.stats(),
    };
  } finally {
    await f.close();
  }
}

const samples = [];

for (let run = 0; run < 5; run++) samples.push(await sample());

console.log(
  JSON.stringify(
    {
      kind: "detached-synthetic-only",
      load: loadavg(),
      bun: Bun.version,
      limits:
        "defaults, 32 waiters, two versions, two files per artifact; no network/server/compiler",
      samples,
    },
    null,
    2
  )
);
