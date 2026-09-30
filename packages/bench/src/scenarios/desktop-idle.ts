/**
 * desktop-idle: the built Desktop App against a fresh Daemon, settled, with
 * the process-tree sampler rooted at Electron's main process (renderer, GPU,
 * network and other helpers are its children). M1 budget: under 1 GB in all.
 * Build it first: `bun run --cwd apps/desktop build`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Effect } from "effect";
import { createTempDir, REPO_ROOT } from "../daemon.ts";
import { settle } from "../drive.ts";
import { startSampler } from "../sampler.ts";
import { count, cpu, type Metric, memory, type Scenario, time } from "../types.ts";

const APP_DIR = join(REPO_ROOT, "apps", "desktop");

const BUNDLED = join(APP_DIR, "out", "Polaris.app", "Contents", "MacOS", "Electron");

/** The unpacked Polaris.app when built, else Electron running `apps/desktop` (`out/` must exist). */
const appCommand = (): ReadonlyArray<string> | null => {
  if (existsSync(BUNDLED)) return [BUNDLED];

  if (!existsSync(join(APP_DIR, "out", "main", "index.js"))) return null;
  const require = createRequire(join(APP_DIR, "package.json"));

  // SAFETY: electron's main module exports the binary's path as a string.
  return [require("electron") as string, APP_DIR];
};

const READY_LINE = "polaris: ready";

const READY_TIMEOUT_MS = 30_000;

interface Launched {
  readonly child: ChildProcess;
  readonly readyMs: number;
}

interface LaunchInput {
  readonly command: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

/** Spawns the app and resolves once main prints the ready line (window painted, Host connected). */
const launchApp = ({ command, env }: LaunchInput) =>
  Effect.callback<Launched, Error>((resume) => {
    const [bin = "", ...args] = command;
    const started = performance.now();
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resume(Effect.fail(new Error(`the app never became ready:\n${output.slice(-2000)}`)));
    }, READY_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();

      if (!output.includes(READY_LINE)) return;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      resume(Effect.succeed({ child, readyMs: performance.now() - started }));
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  });

const quit = (child: ChildProcess) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();

          return;
        }

        const kill = setTimeout(() => child.kill("SIGKILL"), 5000);

        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        child.kill("SIGTERM");
      })
  );

const MiB = 1024 * 1024;

export const desktopIdle: Scenario = {
  name: "desktop-idle",
  description: "the built Desktop App, settled against a Daemon: whole process tree",
  run: (ctx) =>
    Effect.gen(function* () {
      const command = appCommand();

      if (process.platform !== "darwin" || command === null) {
        return {
          metrics: {},
          notes: [
            "skipped: macOS only, and build the app first (bun run --cwd apps/desktop build)",
          ],
        };
      }

      const daemon = yield* ctx.launch();
      const hidden = process.env.POLARIS_BENCH_DESKTOP_HIDDEN === "1";

      const { child, readyMs } = yield* Effect.acquireRelease(
        launchApp({
          command,
          env: {
            ...process.env,
            POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
            POLARIS_DESKTOP_BENCH_HARNESS: "1",
            POLARIS_DESKTOP_USER_DATA: createTempDir("desktop"),
            POLARIS_DESKTOP_HIDDEN: hidden ? "1" : "0",
          },
        }),
        ({ child: app }) => quit(app)
      );

      const pid = child.pid ?? 0;

      yield* settle(ctx.quick ? 3000 : 10_000);
      const sampler = startSampler({ roots: () => [pid], intervalMs: 250 });

      yield* Effect.addFinalizer(() => Effect.sync(() => sampler.stop()));
      yield* settle(ctx.quick ? 3000 : 10_000);
      const report = sampler.report();
      const metrics: Record<string, Metric> = {};

      Object.assign(metrics, {
        ready_ms: time(readyMs, { info: true }),
        rss_mib: memory(report.rssBytes.median, { info: true }),
        cpu_idle_pct: cpu(report.cpuAvgPct),
        processes: count(report.maxProcesses, "processes", { info: true }),
      } satisfies Record<string, Metric>);

      if (report.footprintBytes !== null) {
        metrics.footprint_mib = memory(report.footprintBytes.median, {
          tolerance: { relative: 0.15, absolute: 20 },
        });
      }

      return {
        metrics,
        notes: [
          `window ${hidden ? "hidden" : "shown"}; ${command.length === 1 ? "Polaris.app" : "electron apps/desktop"}`,
          "M1 budget: < 1 GB for the whole app (footprint; RSS double-counts shared framework pages)",
          ...report.processes.map(
            (p) =>
              `${p.name} (${p.pid}): peak RSS ${Math.round(p.maxRssBytes / MiB)} MiB, ${p.cpuSeconds.toFixed(2)} s CPU`
          ),
        ],
      };
    }),
};
