/**
 * `ChildProcess`'s plain half: the request, the started child, and the `node:child_process`
 * implementation, with no Effect, so the Squirrel bootstrap can start Update.exe through it
 * before the Client runtime loads.
 */
import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export type Stdio = "pipe" | "ignore" | "inherit";

export interface SpawnRequest {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  /** Default: stdin ignored, stdout and stderr piped. */
  readonly stdio?: readonly [Stdio, Stdio, Stdio];
  /** A visible console is wanted (a terminal window); hidden by default, also on Windows. */
  readonly visible?: boolean;
  /** Outlives this process (a terminal window the user closes). */
  readonly detached?: boolean;
  /** Windows: pass the arguments to the program exactly as given (cmd's own quoting). */
  readonly verbatimArguments?: boolean;
  /** Killed after this long. */
  readonly timeoutMs?: number;
}

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

/** The events callers listen to, as `node:child_process` emits them. */
interface ChildEvents {
  (event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  (event: "exit" | "close", listener: ExitListener): void;
  (event: "spawn", listener: () => void): void;
}

/** What callers use of a started child: its pipes, its events, and kill. */
export interface Spawned {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly kill: (signal?: NodeJS.Signals | number) => boolean;
  readonly unref: () => void;
  readonly on: ChildEvents;
  readonly once: ChildEvents;
}

export interface ChildProcessApi {
  /** Starts `request`; a failure to start arrives as the child's `error` event (`spawnFailed`). */
  readonly spawn: (request: SpawnRequest) => Spawned;
}

/** Why a child never started: its program is missing, not runnable, or something else. */
export type SpawnFailureReason = "missing" | "denied" | "failed";

/** The errno code of a child that couldn't start (`ENOENT`, `EACCES`), else its message. */
export const spawnErrorCode = (error: NodeJS.ErrnoException): string => error.code ?? error.message;

export const spawnFailureReason = (error: NodeJS.ErrnoException): SpawnFailureReason => {
  const code = spawnErrorCode(error);

  if (code === "ENOENT") return "missing";

  return code === "EACCES" || code === "EPERM" ? "denied" : "failed";
};

/** `node:child_process` (Electron main, Node, Bun); `start` is injectable to record the options. */
export const nodeChildProcess = (start: typeof nodeSpawn = nodeSpawn): ChildProcessApi => ({
  spawn: (request) => {
    const options: SpawnOptions = {
      stdio: [...(request.stdio ?? ["ignore", "pipe", "pipe"])],
      env: request.env ?? process.env,
      // A GUI parent on Windows would give each console child its own window.
      windowsHide: request.visible !== true,
    };

    if (request.cwd !== undefined) options.cwd = request.cwd;

    if (request.detached === true) options.detached = true;

    if (request.verbatimArguments === true) options.windowsVerbatimArguments = true;

    if (request.timeoutMs !== undefined) options.timeout = request.timeoutMs;

    return start(request.file, [...request.args], options);
  },
});

/** The process the Client runs in, for callers that take a `ChildProcessApi` directly. */
export const childProcesses: ChildProcessApi = nodeChildProcess();

/** SIGTERM, then SIGKILL if it's still running after `graceMs`; Windows terminates either way. */
export const stopChild = (child: Spawned, graceMs = 3000): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();

      return;
    }

    const force = setTimeout(() => child.kill("SIGKILL"), graceMs);

    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
