/**
 * Which Daemon socket the local Host connects to, and, in dev only, a Daemon
 * this app starts from source and owns. See docs/adr/0007-the-desktop-dev-daemon-is-its-own.md.
 *
 *   POLARIS_DESKTOP_LOCAL_SOCKET=<path>   use this socket (benchmarks, smoke tests)
 *   POLARIS_DESKTOP_BENCH_HARNESS=1       …and it runs the scripted bench Harness
 *   POLARIS_DESKTOP_DAEMON=system|dev     dev only: force the system or the dev Daemon
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface LocalDaemon {
  readonly socketPath: string;
  /** The Daemon runs `POLARIS_BENCH_HARNESS=1`, so the proof session spends no tokens. */
  readonly benchHarness: boolean;
  /** Stops the Daemon if this app started it; a no-op otherwise. */
  readonly stop: () => Promise<void>;
}

export interface LocalDaemonOptions {
  readonly dev: boolean;
  /** The repository root; the dev Daemon runs from `apps/daemon/src/main.ts` there. */
  readonly repoRoot: string;
  readonly env: NodeJS.ProcessEnv;
}

export const systemSocket = () => join(homedir(), ".polaris", "daemon.sock");

/** The dev Daemon's own `POLARIS_HOME`, kept apart from the real `~/.polaris`. */
export const devHome = () => join(tmpdir(), "polaris-desktop-dev");

const external = (socketPath: string, benchHarness: boolean): LocalDaemon => ({
  socketPath,
  benchHarness,
  stop: () => Promise.resolve(),
});

/** Whether something accepts connections on the socket within `timeoutMs`. */
export const socketLive = (socketPath: string, timeoutMs = 500): Promise<boolean> =>
  new Promise((resolve) => {
    if (!existsSync(socketPath)) {
      resolve(false);

      return;
    }

    const socket = connect(socketPath);

    const done = (live: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(live);
    };

    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForSocket = async (socketPath: string, child: ChildProcess, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev Daemon exited with ${child.exitCode}`);

    if (await socketLive(socketPath, 200)) return;
    await sleep(50);
  }

  throw new Error(`dev Daemon did not open ${socketPath} within ${timeoutMs} ms`);
};

const stopChild = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();

      return;
    }

    const kill = setTimeout(() => child.kill("SIGKILL"), 3000);

    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });

/** Starts `bun apps/daemon/src/main.ts serve --foreground` with the bench Harness and its own home. */
export const startDevDaemon = async ({
  repoRoot,
  env,
}: LocalDaemonOptions): Promise<LocalDaemon> => {
  const home = devHome();
  const socketPath = join(home, "daemon.sock");

  mkdirSync(home, { recursive: true });

  if (await socketLive(socketPath)) {
    console.log(`polaris: reusing the dev Daemon at ${socketPath}`);

    return external(socketPath, true);
  }

  const child = spawn("bun", [join(repoRoot, "apps/daemon/src/main.ts"), "serve", "--foreground"], {
    cwd: repoRoot,
    env: { ...env, POLARIS_HOME: home, POLARIS_BENCH_HARNESS: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });

  console.log(`polaris: started the dev Daemon (pid ${child.pid}, home ${home})`);
  await waitForSocket(socketPath, child, 15_000);

  return { socketPath, benchHarness: true, stop: () => stopChild(child) };
};

export const resolveLocalDaemon = async (options: LocalDaemonOptions): Promise<LocalDaemon> => {
  const { env } = options;
  const explicit = env.POLARIS_DESKTOP_LOCAL_SOCKET;

  if (explicit !== undefined && explicit !== "") {
    return external(explicit, env.POLARIS_DESKTOP_BENCH_HARNESS === "1");
  }

  const system = systemSocket();

  if (!options.dev || env.POLARIS_DESKTOP_DAEMON === "system") return external(system, false);

  if (env.POLARIS_DESKTOP_DAEMON !== "dev" && (await socketLive(system))) {
    return external(system, false);
  }

  return startDevDaemon(options);
};
