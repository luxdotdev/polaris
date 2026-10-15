/**
 * The one way the Daemon runs git: the Host's own `git` CLI and credentials, no JS
 * git. Calls run with `safeConfig.ts`'s settings unless they're git the user asked for.
 */
import { childEnv } from "../service/childEnv.ts";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { ServiceError } from "../services.ts";
import { megabytes, readBounded, readHead } from "./output.ts";
import { safeConfigEnv, withoutDiffDrivers } from "./safeConfig.ts";

export interface GitResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface GitOptions {
  /** Extra environment on top of the Daemon's own (e.g. `GIT_INDEX_FILE`). */
  readonly env?: Record<string, string>;
  readonly stdin?: Uint8Array | string;
  /** Treat these exit codes as success (e.g. `git diff --no-index` exits 1 on differences). */
  readonly okCodes?: ReadonlyArray<number>;
  /** Kill git (SIGKILL) after this long; it then fails with exit code 137 or similar. */
  readonly timeoutMs?: number;
  /** Aborting sends SIGTERM to git's process group: git removes its lock files, ssh stops too. */
  readonly signal?: AbortSignal;
  /**
   * `"host"` is git the user asked for (commit, sync, Accept, stage): the Host's
   * config and hooks as they are. The default turns off everything that runs a command.
   */
  readonly config?: "safe" | "host";
  /** Stop git once stdout passes this; it then fails with `GitOutputTooLarge`. */
  readonly maxOutputBytes?: number;
}

/** What any one git call may print: far past real metadata, well short of the Daemon's memory. */
export const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const MAX_STDERR_BYTES = 64 * 1024;

/** git printed more than its caller's limit; it was killed before the rest was read. */
export class GitOutputTooLarge extends Error {
  constructor(
    readonly args: ReadonlyArray<string>,
    readonly limit: number,
    message = `git's output passed ${megabytes(limit)}, so Polaris stopped it`
  ) {
    super(message);
  }
}

/**
 * Environment every git call gets: never prompt for credentials (there is no
 * TTY), never take optional locks (a background `git status` must not fight
 * the user's own git for `index.lock`), and a stable locale for parsing.
 */
export const baseEnv = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
});

const killGroup = (pid: number) => {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
};

/** A repository's own hooks never run in a checkout Polaris makes (a relative husky `core.hooksPath`). */
export const HOOKS_OFF: ReadonlyArray<string> = ["-c", "core.hooksPath=/dev/null"];

export const runGitRaw = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {}
): Promise<GitResult> => {
  const host = options.config === "host";
  const base = { ...baseEnv(), ...options.env };
  const safe = host ? {} : await safeConfigEnv(cwd, base);

  const spawnOptions: Bun.SpawnOptions.OptionsObject<"ignore" | Blob, "pipe", "pipe"> = {
    cwd,
    env: childEnv({ ...base, ...safe }),
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  };

  if (options.timeoutMs !== undefined) {
    spawnOptions.timeout = options.timeoutMs;
    spawnOptions.killSignal = "SIGKILL";
  }

  // Its own process group, so an abort also stops what git started (ssh, a credential helper).
  if (options.signal !== undefined) spawnOptions.detached = true;

  const proc = Bun.spawn(["git", ...(host ? args : withoutDiffDrivers(args))], spawnOptions);
  const stop = () => killGroup(proc.pid);

  const overflow = () => {
    proc.kill("SIGKILL");

    if (spawnOptions.detached === true) killGroup(proc.pid);
  };

  options.signal?.addEventListener("abort", stop, { once: true });

  if (options.signal?.aborted === true) stop();
  void proc.exited.then(() => options.signal?.removeEventListener("abort", stop));

  const limit = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;

  const [stdout, stderr, code] = await Promise.all([
    readBounded(proc.stdout, limit, overflow),
    readHead(proc.stderr, MAX_STDERR_BYTES),
    proc.exited,
  ]);

  if (stdout === null) throw new GitOutputTooLarge(args, limit);

  return { code, stdout, stderr };
};

export class GitCommandError extends Error {
  constructor(
    readonly cwd: string,
    readonly args: ReadonlyArray<string>,
    readonly code: number,
    readonly stderr: string
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
}

/** Runs git; rejects with `GitCommandError` on a non-success exit code. */
export const runGit = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {}
): Promise<GitResult> => {
  const result = await runGitRaw(cwd, args, options);
  const ok = result.code === 0 || (options.okCodes?.includes(result.code) ?? false);

  if (!ok) throw new GitCommandError(cwd, args, result.code, result.stderr);

  return result;
};

const decoder = new TextDecoder();

/** Runs git and returns stdout as text with the trailing newline trimmed. */
export const gitText = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {}
): Promise<string> => decoder.decode((await runGit(cwd, args, options)).stdout).replace(/\n$/, "");

/** `git` as an Effect, failing with `ServiceError` (service "git"). */
export const git = (cwd: string, args: ReadonlyArray<string>, options: GitOptions = {}) =>
  Effect.tryPromise({
    try: () => runGit(cwd, args, options),
    catch: (cause) =>
      new ServiceError({
        service: "git",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const gitTextEffect = (cwd: string, args: ReadonlyArray<string>, options: GitOptions = {}) =>
  Effect.tryPromise({
    try: () => gitText(cwd, args, options),
    catch: (cause) =>
      new ServiceError({
        service: "git",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Whether `cwd` could be inside a git work tree: some directory from `cwd` up
 * has a `.git` (a directory, or the file a worktree or submodule has). When
 * none does, git can't find a work tree either, so callers skip spawning it.
 * With `GIT_DIR` or `GIT_WORK_TREE` set, git doesn't look for `.git`: always
 * true then.
 */
export const mayBeInWorkTree = (cwd: string): boolean => {
  if (process.env.GIT_DIR !== undefined || process.env.GIT_WORK_TREE !== undefined) return true;
  let dir = resolve(cwd);

  for (;;) {
    if (existsSync(join(dir, ".git"))) return true;
    const parent = dirname(dir);

    if (parent === dir) return false;
    dir = parent;
  }
};

/** The repository's top level, or null when `cwd` is not inside a git work tree. */
export const findRepoRoot = async (cwd: string): Promise<string | null> => {
  if (!mayBeInWorkTree(cwd)) return null;
  const result = await runGitRaw(cwd, ["rev-parse", "--show-toplevel"]).catch(() => null);

  if (result === null || result.code !== 0) return null;
  const root = decoder.decode(result.stdout).trim();

  return root === "" ? null : root;
};

/** The HEAD commit, or null on an unborn branch. */
export const resolveHead = async (cwd: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);

  return result.code === 0 ? decoder.decode(result.stdout).trim() : null;
};

/** Resolves a ref to a commit, or null when it doesn't exist. */
export const resolveCommit = async (cwd: string, ref: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);

  return result.code === 0 ? decoder.decode(result.stdout).trim() : null;
};

/** The empty tree for this repository's hash algorithm (sha1 or sha256). */
export const emptyTree = (cwd: string): Promise<string> =>
  gitText(cwd, ["hash-object", "-t", "tree", "--stdin"], { stdin: "" });
