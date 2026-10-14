/**
 * Opt-in diagnostics for benchmarks (`packages/bench`) and investigations.
 * Off unless one of these is set when `polaris serve` starts:
 *
 *   POLARIS_DEBUG_DIR=<dir>        SIGUSR1 runs a full GC, then writes a V8 heap snapshot
 *                                  (Chrome DevTools format) to <dir>/heap-<pid>-<n>.heapsnapshot
 *   POLARIS_DEBUG_STATS_MS=<ms>    every <ms>, one JSON line on stderr: memoryUsage() and
 *                                  the event-loop lag of that interval
 *   POLARIS_DEBUG_MODULES=1        once listening, one JSON line on stderr: how many modules
 *                                  start-up loaded (all, and Polaris's own outside node_modules)
 *
 * SIGUSR2 is taken by in-place upgrades (service/upgrade.ts), so this uses SIGUSR1.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const installDebugHooks = (): void => {
  const dir = process.env.POLARIS_DEBUG_DIR;

  if (dir) {
    let count = 0;
    process.on("SIGUSR1", () => {
      mkdirSync(dir, { recursive: true });
      Bun.gc(true);
      const file = join(dir, `heap-${process.pid}-${++count}.heapsnapshot`);
      // Written under a temporary name, so a watcher sees the file only once complete.
      writeFileSync(`${file}.tmp`, new Uint8Array(Bun.generateHeapSnapshot("v8", "arraybuffer")));
      renameSync(`${file}.tmp`, file);
      process.stderr.write(`polaris debug: wrote ${file}\n`);
    });
  }

  const statsMs = Number(process.env.POLARIS_DEBUG_STATS_MS);

  if (statsMs > 0) {
    let expected = performance.now() + statsMs;
    setInterval(() => {
      const now = performance.now();
      const lagMs = Math.max(0, now - expected);
      expected = now + statsMs;
      const m = process.memoryUsage();
      process.stderr.write(
        `${JSON.stringify({ polarisStats: { at: Date.now(), lagMs, rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers } })}\n`
      );
    }, statsMs);
  }
};

/** The start-up graph's size, for the bench's `cold-start` gate (`polarisModules` on stderr). */
export const reportStartupModules = (): void => {
  if (process.env.POLARIS_DEBUG_MODULES !== "1") return;

  const loaded = Object.keys(require.cache);
  const polaris = loaded.filter((path) => !path.includes("/node_modules/")).length;

  process.stderr.write(`${JSON.stringify({ polarisModules: { all: loaded.length, polaris } })}\n`);
};
