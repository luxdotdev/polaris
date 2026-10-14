#!/usr/bin/env bun
/**
 * `bun test` with a stall watchdog: when the run prints nothing for
 * `POLARIS_TEST_STALL_S` seconds (default 300), it is killed, with its process
 * group, and the file it was in is named, so a hang fails instead of waiting forever.
 *
 *   bun ../../tooling/test/watchdog.ts [bun test args…]
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** What the run has shown so far, read from bun's per-file reporter. */
interface Progress {
  readonly file: string | null;
  readonly lastTest: string | null;
}

const initialProgress: Progress = { file: null, lastTest: null };

const FILE_HEADER = /^(\S.*\.(?:test|spec)\.[cm]?[jt]sx?):$/;

const TEST_LINE = /^\((?:pass|fail|skip|todo)\) /;

const observe = (progress: Progress, line: string): Progress => {
  const header = FILE_HEADER.exec(line);

  if (header) return { ...progress, file: header[1] ?? null, lastTest: null };

  if (TEST_LINE.test(line)) return { ...progress, lastTest: line };

  return progress;
};

const stallReport = (progress: Progress, seconds: number): string => {
  const where = progress.file ?? "before the first test file reported";
  const after = progress.lastTest ? `\n  last result: ${progress.lastTest}` : "";

  return `bun test stalled: no output for ${seconds}s, in ${where}${after}`;
};

/** Bun's reporter hides file headers from coding agents, and the watchdog needs them. */
const AGENT_ENV = ["CLAUDECODE", "AI_AGENT", "CLAUDE_CODE_ENTRYPOINT", "CURSOR_AGENT"];

const quiet = AGENT_ENV.some((name) => process.env[name]);

const run = async (args: ReadonlyArray<string>): Promise<number> => {
  const stallSeconds = Number(process.env.POLARIS_TEST_STALL_S ?? 300);
  const env = { ...process.env };

  for (const name of AGENT_ENV) delete env[name];

  const child = spawn("bun", ["test", ...args], {
    env,
    detached: process.platform !== "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });

  const killGroup = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === "win32" || !child.pid) child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      // The group is already gone.
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      killGroup(signal);
      process.exit(130);
    });

  let progress = initialProgress;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      console.error(`\n${stallReport(progress, stallSeconds)}`);
      killGroup("SIGKILL");
    }, stallSeconds * 1000);
  };

  const follow = (stream: NodeJS.ReadableStream, write: (line: string) => void) =>
    createInterface({ input: stream }).on("line", (line) => {
      arm();
      progress = observe(progress, line);

      if (!(quiet && (line.startsWith("(pass) ") || FILE_HEADER.test(line)))) write(line);
    });

  follow(child.stdout, (line) => console.log(line));
  follow(child.stderr, (line) => console.error(line));
  arm();

  const code = await new Promise<number>((resolve) =>
    child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)))
  );

  clearTimeout(timer);

  return stalled ? 1 : code;
};

if (import.meta.main) process.exit(await run(process.argv.slice(2)));
