import { childEnv } from "../service/childEnv.ts";
import { execFile } from "node:child_process";
import { Schema } from "effect";
import { processCreated } from "../platform/windowsNative.ts";

/** `ps` never answered: whether the process lives is unknown, so nothing may be decided on it. */
export class ProcessIdentityUnknown extends Schema.TaggedError<ProcessIdentityUnknown>()(
  "ProcessIdentityUnknown",
  { pid: Schema.Number }
) {}

/** One `ps` run: its stdout, or null when it failed. */
export interface PsRun {
  readonly output: Promise<string | null>;
  readonly kill: () => void;
}

const runPs = (pid: number): PsRun => {
  let kill = () => {};

  const output = new Promise<string | null>((resolve) => {
    const child = execFile(
      "ps",
      ["-o", "stat=", "-o", "lstart=", "-p", String(pid)],
      { env: childEnv() },
      (error, stdout) => resolve(error === null ? stdout : null)
    );

    kill = () => child.kill("SIGKILL");
  });

  return { output, kill };
};

export interface PsOptions {
  readonly run?: (pid: number) => PsRun;
  /** How long one run may take; Bun under load can lose a child's exit (ENG-356). */
  readonly attemptMs?: number;
  readonly attempts?: number;
}

const timedOut = Symbol("timedOut");

const attempt = async (run: PsRun, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), ms);
  });

  try {
    return await Promise.race([run.output, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

const psIdentity = async (pid: number, options: PsOptions): Promise<string | null> => {
  const { run = runPs, attemptMs = 5000, attempts = 3 } = options;

  for (let n = 0; n < attempts; n++) {
    const current = run(pid);
    const stdout = await attempt(current, attemptMs);

    if (stdout === timedOut) {
      current.kill();
      continue;
    }

    const line = stdout?.trim() ?? "";

    return line.length === 0 || /^[ZX]/.test(line) ? null : line.replace(/^\S+\s+/, "");
  }

  throw new ProcessIdentityUnknown({ pid });
};

/**
 * A PID plus its start time distinguishes a recovered child from a reused PID; null when no
 * such process runs. Rejects with ProcessIdentityUnknown when `ps` never answers.
 */
export const processIdentity = (pid: number, options: PsOptions = {}): Promise<string | null> => {
  // Windows has no `ps`: its kernel reports the start time (a FILETIME) directly.
  if (process.platform === "win32") {
    const started = processCreated(pid);

    return Promise.resolve(started === null ? null : `filetime ${started}`);
  }

  return psIdentity(pid, options);
};
