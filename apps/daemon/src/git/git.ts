/**
 * The one way the Daemon runs git: the Host's own `git` CLI, so the user's
 * config, credentials and hooks apply. No JS git implementation.
 */
import { Effect } from "effect"
import { ServiceError } from "../services.ts"

export interface GitResult {
  readonly code: number
  readonly stdout: Uint8Array
  readonly stderr: string
}

export interface GitOptions {
  /** Extra environment on top of the Daemon's own (e.g. `GIT_INDEX_FILE`). */
  readonly env?: Record<string, string>
  readonly stdin?: Uint8Array | string
  /** Treat these exit codes as success (e.g. `git diff --no-index` exits 1 on differences). */
  readonly okCodes?: ReadonlyArray<number>
}

/**
 * Environment every git call gets: never prompt for credentials (there is no
 * TTY), never take optional locks (a background `git status` must not fight
 * the user's own git for `index.lock`), and a stable locale for parsing.
 */
const baseEnv = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
})

export const runGitRaw = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {},
): Promise<GitResult> => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...baseEnv(), ...options.env },
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

export class GitCommandError extends Error {
  constructor(
    readonly cwd: string,
    readonly args: ReadonlyArray<string>,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`)
  }
}

/** Runs git; rejects with `GitCommandError` on a non-success exit code. */
export const runGit = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {},
): Promise<GitResult> => {
  const result = await runGitRaw(cwd, args, options)
  const ok = result.code === 0 || (options.okCodes?.includes(result.code) ?? false)
  if (!ok) throw new GitCommandError(cwd, args, result.code, result.stderr)
  return result
}

const decoder = new TextDecoder()

/** Runs git and returns stdout as text with the trailing newline trimmed. */
export const gitText = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {},
): Promise<string> => decoder.decode((await runGit(cwd, args, options)).stdout).replace(/\n$/, "")

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
  })

export const gitTextEffect = (cwd: string, args: ReadonlyArray<string>, options: GitOptions = {}) =>
  Effect.tryPromise({
    try: () => gitText(cwd, args, options),
    catch: (cause) =>
      new ServiceError({
        service: "git",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/** The repository's top level, or null when `cwd` is not inside a git work tree. */
export const findRepoRoot = async (cwd: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["rev-parse", "--show-toplevel"]).catch(() => null)
  if (result === null || result.code !== 0) return null
  const root = decoder.decode(result.stdout).trim()
  return root === "" ? null : root
}

/** The HEAD commit, or null on an unborn branch. */
export const resolveHead = async (cwd: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
  return result.code === 0 ? decoder.decode(result.stdout).trim() : null
}

/** Resolves a ref to a commit, or null when it doesn't exist. */
export const resolveCommit = async (cwd: string, ref: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
  return result.code === 0 ? decoder.decode(result.stdout).trim() : null
}

/** The empty tree for this repository's hash algorithm (sha1 or sha256). */
export const emptyTree = (cwd: string): Promise<string> =>
  gitText(cwd, ["hash-object", "-t", "tree", "--stdin"], { stdin: "" })
