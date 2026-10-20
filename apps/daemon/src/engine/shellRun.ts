/**
 * Runs the user's shell command (`RunShellCommand`) on the Host: their login shell, in the
 * session's directory, with no terminal. Each stream is capped, the command times out, and
 * aborting its signal (Interrupt) ends it and everything it started.
 */
import { executableOf } from "../platform/executable.ts";
import { killTree, ownProcessGroup, shellCommand } from "../platform/processes.ts";
import { loginShell } from "../terminal/shell.ts";

/** Characters kept of each stream (Claude Code's Bash tool keeps about as many). */
export const SHELL_OUTPUT_LIMIT = 30_000;

export const SHELL_TIMEOUT_MS = 10 * 60_000;

/** After SIGTERM, how long the command has before SIGKILL. */
const KILL_GRACE_MS = 2000;

/** After the shell exits, how long a pipe held open by something it left running may still take. */
const DRAIN_GRACE_MS = 500;

export interface ShellRunOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Aborted to stop the command (Interrupt, the Daemon stopping). */
  readonly signal: AbortSignal;
  /** Both streams so far, as they arrived; called as output grows. */
  readonly onOutput?: (output: string) => void;
  readonly timeoutMs?: number;
  readonly limit?: number;
}

export interface ShellExit {
  readonly stdout: string;
  readonly stderr: string;
  /** Both streams, interleaved as they arrived. */
  readonly output: string;
  /** Null when it never started or was killed. */
  readonly exitCode: number | null;
  /** `interrupted` when its signal was aborted. */
  readonly ending: "exited" | "interrupted" | "timed-out" | "not-started";
  /** Why it couldn't start, for `not-started`. */
  readonly error: string | null;
}

/** A stream's text up to `limit` characters, then how much was left out. */
const cappedText = (limit: number) => {
  let text = "";
  let dropped = 0;

  return {
    add: (chunk: string) => {
      const room = Math.max(0, limit - text.length);

      text += chunk.slice(0, room);
      dropped += Math.max(0, chunk.length - room);
    },
    value: () => (dropped === 0 ? text : `${text}\n… ${dropped} more characters`),
  };
};

/** Reads a pipe as text until it closes or is cancelled. */
const pump = (pipe: ReadableStream<Uint8Array>, onText: (text: string) => void) => {
  const reader = pipe.getReader();
  const decoder = new TextDecoder();

  const done = (async () => {
    try {
      while (true) {
        const next = await reader.read();

        if (next.done) break;
        onText(decoder.decode(next.value, { stream: true }));
      }
    } catch {
      // Cancelled: something the command left running still holds the pipe.
    }

    const rest = decoder.decode();

    if (rest !== "") onText(rest);
  })();

  return { done, cancel: () => reader.cancel().catch(() => undefined) };
};

/** Resolves true once every pump is done, false if `ms` passes first. */
const drainedWithin = async (
  pumps: ReadonlyArray<{ readonly done: Promise<void> }>,
  ms: number
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));

  const drained = await Promise.race([
    Promise.all(pumps.map((p) => p.done)).then(() => true),
    late,
  ]);

  clearTimeout(timer);

  return drained;
};

/** The argv: the login shell's `-l -c` on macOS and Linux (the user's PATH), cmd.exe on Windows. */
export const shellArgv = (command: string, os: string = process.platform) =>
  os === "win32"
    ? shellCommand(command, os)
    : { argv: [loginShell(), "-l", "-c", command], windowsVerbatimArguments: false };

const spawn = (options: ShellRunOptions) => {
  const shell = shellArgv(options.command);
  const [program = "/bin/sh", ...args] = shell.argv;

  return Bun.spawn([executableOf(program, options.env), ...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: ownProcessGroup(),
    windowsVerbatimArguments: shell.windowsVerbatimArguments,
  });
};

const notStarted = (error: string): ShellExit => ({
  stdout: "",
  stderr: "",
  output: "",
  exitCode: null,
  ending: "not-started",
  error,
});

/** Runs the command to its end; never rejects. */
export const runShell = async (options: ShellRunOptions): Promise<ShellExit> => {
  const limit = options.limit ?? SHELL_OUTPUT_LIMIT;

  if (options.signal.aborted) return { ...notStarted("interrupted"), ending: "interrupted" };
  let child: ReturnType<typeof spawn>;

  try {
    child = spawn(options);
  } catch (error) {
    return notStarted(error instanceof Error ? error.message : String(error));
  }

  const proc = child;
  let ending: ShellExit["ending"] = "exited";
  let hardKill: ReturnType<typeof setTimeout> | undefined;

  const stop = (why: "interrupted" | "timed-out") => {
    if (ending !== "exited" || proc.exitCode !== null) return;
    ending = why;
    void killTree(proc.pid, "SIGTERM");
    hardKill = setTimeout(() => void killTree(proc.pid, "SIGKILL"), KILL_GRACE_MS);
  };

  const onAbort = () => stop("interrupted");

  options.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("timed-out"), options.timeoutMs ?? SHELL_TIMEOUT_MS);
  const stdout = cappedText(limit);
  const stderr = cappedText(limit);
  const both = cappedText(limit * 2);

  const into = (stream: ReturnType<typeof cappedText>) => (text: string) => {
    stream.add(text);
    both.add(text);
    options.onOutput?.(both.value());
  };

  const pumps = [pump(proc.stdout, into(stdout)), pump(proc.stderr, into(stderr))];
  const exitCode = await proc.exited;

  clearTimeout(timer);
  clearTimeout(hardKill);
  options.signal.removeEventListener("abort", onAbort);

  // A stopped command's children don't outlive it, even ones that ignored SIGTERM.
  if (ending !== "exited") void killTree(proc.pid, "SIGKILL");

  // Something it started in the background may hold a pipe: stop reading, leave it running.
  if (!(await drainedWithin(pumps, DRAIN_GRACE_MS))) {
    for (const p of pumps) await p.cancel();
    await Promise.all(pumps.map((p) => p.done));
  }

  return {
    stdout: stdout.value(),
    stderr: stderr.value(),
    output: both.value(),
    exitCode: ending === "exited" ? exitCode : null,
    ending,
    error: null,
  };
};
