/**
 * `git.sync`: fetch, pull, push and publish the checked-out branch with the
 * Host's own git and credentials. Never prompts, never forces.
 */
import type { GitSyncAction, GitSyncFailure, GitSyncStep } from "@polaris/protocol";
import { type GitResult, runGitRaw } from "./git.ts";
import { batchSshCommand } from "./review/remotes.ts";
import { toplevel } from "./write.ts";

/** A stalled transfer is cut by git's low-speed limit; this bounds a whole step. */
export const SYNC_TIMEOUT_MS = 10 * 60 * 1000;

/** No credential UI (Git Credential Manager), and give up on a stalled HTTP transfer. */
const NO_PROMPT_CONFIG: ReadonlyArray<string> = [
  "-c",
  "credential.interactive=false",
  "-c",
  "http.lowSpeedLimit=1000",
  "-c",
  "http.lowSpeedTime=60",
];

export type SyncEvent =
  | { readonly kind: "step"; readonly step: GitSyncStep; readonly remote: string }
  | { readonly kind: "done" }
  | {
      readonly kind: "failed";
      readonly reason: GitSyncFailure;
      readonly exitCode: number | null;
      readonly output: string;
    };

const decoder = new TextDecoder();

/** `git config -z --list`: keys with section and name lowercased, as git prints them. */
const readConfig = async (top: string): Promise<ReadonlyMap<string, string>> => {
  const result = await runGitRaw(top, ["config", "-z", "--list"]);
  const config = new Map<string, string>();

  for (const record of decoder.decode(result.stdout).split("\0")) {
    const at = record.indexOf("\n");

    if (record !== "") config.set(at < 0 ? record : record.slice(0, at), record.slice(at + 1));
  }

  return config;
};

/** Remote names in the order the config defines them. */
const remotesIn = (config: ReadonlyMap<string, string>): ReadonlyArray<string> => {
  const names = new Set<string>();

  for (const key of config.keys()) {
    const match = /^remote\.(.+)\.url$/.exec(key);

    if (match?.[1] !== undefined) names.add(match[1]);
  }

  return [...names];
};

/** Where Publish branch pushes: origin, else the first remote; null without one. */
export const publishRemote = (remotes: ReadonlyArray<string>): string | null =>
  remotes.includes("origin") ? "origin" : (remotes[0] ?? null);

/** `git.status`'s `tracking.remote`: only asked of git when the branch has no upstream. */
export const publishRemoteAt = async (cwd: string): Promise<string | null> => {
  const result = await runGitRaw(cwd, ["remote"]);

  if (result.code !== 0) return null;

  return publishRemote(decoder.decode(result.stdout).split("\n").filter(Boolean));
};

interface Repo {
  readonly top: string;
  readonly branch: string | null;
  readonly config: ReadonlyMap<string, string>;
  readonly remotes: ReadonlyArray<string>;
  /** The branch's upstream remote and ref (`branch.<b>.remote` / `.merge`), when both are set. */
  readonly upstream: { readonly remote: string; readonly merge: string } | null;
}

const readRepo = async (cwd: string): Promise<Repo> => {
  const top = await toplevel(cwd);

  const [symbolic, config] = await Promise.all([
    runGitRaw(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    readConfig(top),
  ]);

  const branch = symbolic.code === 0 ? decoder.decode(symbolic.stdout).trim() : null;
  const remote = branch === null ? undefined : config.get(`branch.${branch}.remote`);
  const merge = branch === null ? undefined : config.get(`branch.${branch}.merge`);

  return {
    top,
    branch,
    config,
    remotes: remotesIn(config),
    upstream:
      remote === undefined || merge === undefined || remote === "." ? null : { remote, merge },
  };
};

/** The repository chose how to pull (merge, rebase or ff); else Polaris pulls `--ff-only`. */
const pullIsConfigured = (repo: Repo) =>
  repo.config.has("pull.rebase") ||
  repo.config.has("pull.ff") ||
  (repo.branch !== null && repo.config.has(`branch.${repo.branch}.rebase`));

/** The last lines of what git said: the reason is at the end. */
const tail = (result: GitResult): string => {
  const text = `${decoder.decode(result.stdout)}\n${result.stderr}`.trim();

  return text.split("\n").slice(-20).join("\n");
};

const AUTH =
  /Permission denied|publickey|Authentication failed|could not read (Username|Password)|unable to get (password|username)|terminal prompts disabled|Host key verification failed|Invalid username or password|HTTP Basic: Access denied|returned error: 40[13]/i;

const NETWORK =
  /Could not resolve host|Could not resolve hostname|Connection refused|Connection timed out|Operation timed out|Network is unreachable|No route to host|Failed to connect|unable to access|Connection reset|operation too slow|early EOF/i;

const failureOf = (step: GitSyncStep, result: GitResult): GitSyncFailure => {
  const text = `${decoder.decode(result.stdout)}\n${result.stderr}`;

  if (AUTH.test(text)) return "auth";

  if (
    step === "push" &&
    /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/.test(text)
  )
    return "rejected";

  if (
    step === "pull" &&
    /CONFLICT|Automatic merge failed|could not apply|Resolve all conflicts/.test(text)
  )
    return "conflicts";

  if (
    step === "pull" &&
    /would be overwritten|commit your changes or stash them|You have unstaged changes|uncommitted changes/i.test(
      text
    )
  )
    return "local-changes";

  if (
    step === "pull" &&
    /Not possible to fast-forward|divergent branches|Diverging branches/i.test(text)
  )
    return "diverged";

  if (NETWORK.test(text)) return "network";

  return "failed";
};

type Emit = (event: SyncEvent) => void;

interface Run {
  readonly repo: Repo;
  readonly emit: Emit;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

const failed = (
  emit: Emit,
  reason: GitSyncFailure,
  output = "",
  exitCode: number | null = null
): false => {
  emit({ kind: "failed", reason, exitCode, output });

  return false;
};

/** One git step, killed when the stream closes or after `timeoutMs`; true when it succeeded. */
const step = async (
  run: Run,
  name: GitSyncStep,
  remote: string,
  args: ReadonlyArray<string>
): Promise<boolean> => {
  if (run.signal.aborted) return false;
  run.emit({ kind: "step", step: name, remote });
  const stop = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, run.timeoutMs);

  const cancel = () => stop.abort();

  run.signal.addEventListener("abort", cancel);

  try {
    const result = await runGitRaw(run.repo.top, [...NO_PROMPT_CONFIG, ...args], {
      signal: stop.signal,
      env: {
        GIT_SSH_COMMAND: await batchSshCommand(run.repo.top),
        // An askpass helper could wait on a window nobody sees; empty turns it off.
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        GIT_EDITOR: "true",
        GIT_MERGE_AUTOEDIT: "no",
      },
    });

    if (run.signal.aborted) return false;

    if (timedOut) return failed(run.emit, "timeout", tail(result));

    return (
      result.code === 0 || failed(run.emit, failureOf(name, result), tail(result), result.code)
    );
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener("abort", cancel);
  }
};

const branchRef = (branch: string) => `refs/heads/${branch}`;

const fetch = (run: Run) => {
  const remote = run.repo.upstream?.remote ?? publishRemote(run.repo.remotes);

  return remote === null
    ? Promise.resolve(failed(run.emit, "no-remote"))
    : step(run, "fetch", remote, ["fetch", remote]);
};

/** The checks pull and push share: a branch, a remote and an upstream. */
const upstreamOf = (run: Run) => {
  if (run.repo.branch === null) return failed(run.emit, "detached");

  if (run.repo.remotes.length === 0) return failed(run.emit, "no-remote");

  return run.repo.upstream ?? failed(run.emit, "no-upstream");
};

const pull = (run: Run) => {
  const upstream = upstreamOf(run);

  if (upstream === false) return Promise.resolve(false);
  const mode = pullIsConfigured(run.repo) ? [] : ["--ff-only"];

  return step(run, "pull", upstream.remote, ["pull", ...mode]);
};

const push = (run: Run) => {
  const upstream = upstreamOf(run);

  if (upstream === false || run.repo.branch === null) return Promise.resolve(false);

  return step(run, "push", upstream.remote, [
    "push",
    upstream.remote,
    `${branchRef(run.repo.branch)}:${upstream.merge}`,
  ]);
};

const publish = (run: Run) => {
  const { branch } = run.repo;

  if (branch === null) return Promise.resolve(failed(run.emit, "detached"));
  const remote = publishRemote(run.repo.remotes);

  if (remote === null) return Promise.resolve(failed(run.emit, "no-remote"));
  const ref = branchRef(branch);

  return step(run, "push", remote, ["push", "-u", remote, `${ref}:${ref}`]);
};

/** Commits HEAD has that its upstream doesn't, after a pull. */
const aheadCount = async (top: string): Promise<number> => {
  const result = await runGitRaw(top, ["rev-list", "--count", "@{upstream}..HEAD"]);

  return result.code === 0 ? Number(decoder.decode(result.stdout).trim()) : 0;
};

/** Pull, then push what's ahead; with no upstream it publishes, as VS Code's Sync offers. */
const sync = async (run: Run) => {
  if (run.repo.branch !== null && run.repo.upstream === null) return publish(run);

  if (!(await pull(run))) return false;

  return (await aheadCount(run.repo.top)) === 0 || push(run);
};

const ACTIONS: Record<GitSyncAction, (run: Run) => Promise<boolean>> = {
  fetch,
  pull,
  push,
  publish,
  sync,
};

export interface SyncOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

/** Runs `action` in the repository at `cwd`, emitting each step and how it ended. */
export const runSync = async (
  cwd: string,
  action: GitSyncAction,
  emit: Emit,
  options: SyncOptions
): Promise<void> => {
  const repo = await readRepo(cwd);

  const run: Run = {
    repo,
    emit,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? SYNC_TIMEOUT_MS,
  };

  if ((await ACTIONS[action](run)) && !options.signal.aborted) emit({ kind: "done" });
};
