#!/usr/bin/env bun
/**
 * `bun run --cwd apps/desktop dev`: the renderer from Vite's dev server (hot
 * reload), the main process rebuilt and Electron restarted when its sources
 * change. Without a system Daemon it starts a dev Daemon (ADR 0007) and keeps
 * it across restarts. Ctrl-C (or quitting the app) stops everything.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { devHome, socketLive, systemSocket } from "../src/main/localDaemon.ts";
import { APP_DIR, buildMain, electronBinary, REPO_ROOT } from "./lib/build.ts";
import { startDaemon, type TestDaemon } from "./lib/daemon.ts";
import { prepareDaemonBuilds } from "./lib/daemonBuilds.ts";

await prepareDaemonBuilds();

const server = await createServer({ configFile: join(APP_DIR, "vite.config.ts") });

await server.listen();

// Never "localhost": Chromium tries ::1 first, where another server may answer.
const rendererUrl = "http://127.0.0.1:5198/";

let daemon: TestDaemon | null = null;

const useSystem =
  process.env.POLARIS_DESKTOP_DAEMON !== "dev" && (await socketLive(systemSocket()));

const devSocket = join(devHome(), "daemon.sock");

if (!useSystem && !(await socketLive(devSocket))) {
  mkdirSync(devHome(), { recursive: true });
  daemon = await startDaemon({ home: devHome(), benchHarness: true });
  console.log(`dev: Daemon on the bench Harness at ${daemon.socketPath}`);
}

await buildMain();

let electron: ChildProcess | null = null;

let restarting = false;

let daemonChanged = false;

const shutdown = async () => {
  setTimeout(() => process.exit(1), 5000).unref();
  watcher.forEach((w) => w.close());
  electron?.kill("SIGTERM");
  await daemon?.stop();
  await server.close();
  process.exit(0);
};

const appEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
    POLARIS_DESKTOP_DEV: "1",
    POLARIS_DESKTOP_USER_DATA:
      process.env.POLARIS_DESKTOP_USER_DATA ?? join(tmpdir(), "polaris-desktop-dev-user-data"),
  };

  if (!useSystem) {
    env.POLARIS_DESKTOP_LOCAL_SOCKET = devSocket;
    env.POLARIS_DESKTOP_BENCH_HARNESS = "1";
  }

  return env;
};

const launch = () => {
  const child = spawn(electronBinary(), [APP_DIR], { stdio: "inherit", env: appEnv() });

  child.once("exit", () => {
    if (!restarting) void shutdown();
  });
  electron = child;
};

const restartOnce = async () => {
  try {
    if (daemonChanged) {
      daemonChanged = false;
      await prepareDaemonBuilds();
    }

    await buildMain();
  } catch (error) {
    console.error("dev: main build failed; keeping the running app", error);

    return;
  }

  restarting = true;
  const old = electron;

  if (old !== null && old.exitCode === null) {
    const exited = new Promise((resolve) => old.once("exit", resolve));

    old.kill("SIGTERM");
    await exited;
  }

  restarting = false;
  launch();
};

let restartRunning = false;

let restartQueued = false;

const restart = async () => {
  restartQueued = true;

  if (restartRunning) return;
  restartRunning = true;

  try {
    while (restartQueued) {
      restartQueued = false;
      await restartOnce();
    }
  } finally {
    restartRunning = false;
  }
};

let timer: ReturnType<typeof setTimeout> | null = null;

const watcher = [
  "apps/desktop/src/main",
  "apps/desktop/src/preload",
  "apps/desktop/src/shared",
  "packages/client/src",
  "packages/protocol/src",
  "apps/daemon/src",
].map((dir) =>
  watch(join(REPO_ROOT, dir), { recursive: true }, () => {
    if (
      dir !== "apps/desktop/src/main" &&
      dir !== "apps/desktop/src/preload" &&
      dir !== "apps/desktop/src/shared"
    )
      daemonChanged = true;

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void restart(), 150);
  })
);

process.on("SIGINT", () => void shutdown());

process.on("SIGTERM", () => void shutdown());

launch();

console.log(`dev: renderer at ${rendererUrl}`);
