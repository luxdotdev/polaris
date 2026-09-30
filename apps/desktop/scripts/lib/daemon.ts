/** A throwaway Daemon from source for the smoke test; runs under Bun and Node. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO_ROOT } from "./electron.ts";

export interface TestDaemon {
  readonly socketPath: string;
  readonly pid: number | undefined;
  readonly stop: () => Promise<void>;
}

export interface StartDaemonInput {
  /** The Daemon's `POLARIS_HOME`. */
  readonly home: string;
  readonly benchHarness: boolean;
}

const live = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    if (!existsSync(socketPath)) {
      resolve(false);

      return;
    }

    const socket = connect(socketPath);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/**
 * The test Daemon's environment: its own POLARIS_HOME and HOME, so it never reads (or
 * indexes, for Usage) the developer's real Harness logs and settings.
 */
const testEnv = (home: string, benchHarness: boolean) => {
  const { CLAUDE_CONFIG_DIR: _claude, CODEX_HOME: _codex, ...env } = process.env;

  return {
    ...env,
    HOME: home,
    POLARIS_HOME: home,
    POLARIS_BENCH_HARNESS: benchHarness ? "1" : "0",
  };
};

export const startDaemon = async ({
  home,
  benchHarness,
}: StartDaemonInput): Promise<TestDaemon> => {
  const socketPath = join(home, "daemon.sock");

  const child = spawn(
    "bun",
    [join(REPO_ROOT, "apps/daemon/src/main.ts"), "serve", "--foreground"],
    {
      cwd: REPO_ROOT,
      env: testEnv(home, benchHarness),
      stdio: ["ignore", "ignore", "inherit"],
    }
  );

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const deadline = Date.now() + 15_000;

  while (!(await live(socketPath))) {
    if (child.exitCode !== null) throw new Error(`the Daemon exited with ${child.exitCode}`);

    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("the Daemon did not open its socket in 15 s");
    }

    await sleep(50);
  }

  return {
    socketPath,
    pid: child.pid,
    stop: async () => {
      child.kill("SIGTERM");
      const killed = setTimeout(() => child.kill("SIGKILL"), 3000);

      await exited;
      clearTimeout(killed);
    },
  };
};
