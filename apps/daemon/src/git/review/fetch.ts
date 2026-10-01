/**
 * Fetching a pull request's head and base into `refs/polaris/review/<n>/`,
 * without moving any of the user's refs and without ever prompting
 * (docs/research/review-checkout.md §2), and pinning an Agent Session's
 * checkpoint commits under the same namespace.
 */
import { ReviewCheckoutBlocker, type RepoRef } from "@polaris/protocol";
import { CheckoutBlocked } from "../../services.ts";
import { type GitResult, resolveCommit, runGitRaw } from "../git.ts";
import { checkoutGit, checkoutGitRaw, reviewRef } from "./refs.ts";
import { batchSshCommand, type FetchSource, pickFetchSource, type Transport } from "./remotes.ts";

/** A stalled transfer is cut by git's low-speed limit; this bounds the whole fetch. */
export const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `--refmap=` keeps git from moving the user's `refs/remotes/<remote>/<base>`;
 * the rest keep their `FETCH_HEAD`, maintenance and tags as they were.
 */
export const FETCH_FLAGS: ReadonlyArray<string> = [
  "--no-write-fetch-head",
  "--no-auto-maintenance",
  "--no-tags",
  "--refmap=",
];

const NO_PROMPT_CONFIG: ReadonlyArray<string> = [
  "-c",
  "credential.interactive=false",
  "-c",
  "http.lowSpeedLimit=1000",
  "-c",
  "http.lowSpeedTime=60",
];

export interface Fetched {
  readonly head: string;
  readonly mergeBase: string;
}

export interface PullRequestFetch {
  readonly repoPath: string;
  /** The refs' key, `reviewRef(key, …)`. */
  readonly key: string;
  readonly repo: RepoRef;
  readonly number: number;
  readonly baseRef: string;
  /** The code host's base commit, fetched by id when a shallow clone lacks the merge base. */
  readonly baseCommit: string;
  /** Fetch full history (`--unshallow`): only when the user asked for it. */
  readonly unshallow: boolean;
  readonly timeoutMs?: number;
}

const decoder = new TextDecoder();

const fetchFailed = (message: string) =>
  new CheckoutBlocked({ blocker: ReviewCheckoutBlocker.cases.FetchFailed.make({ message }) });

const SSH_AUTH_FAILURE = /Permission denied|publickey|Host key verification failed|passphrase/i;

/** What the user reads when the fetch fails, with git's own stderr. */
export const describeFetchFailure = (
  result: GitResult,
  transport: Transport,
  options: { readonly number: number; readonly repo: RepoRef; readonly timeoutMs: number }
): string => {
  const stderr = result.stderr.trim();

  if (result.code === 137 || result.code === 143 || result.code < 0) {
    return `the fetch timed out after ${Math.round(options.timeoutMs / 1000)} s`;
  }

  if (/couldn't find remote ref refs\/pull\//.test(stderr)) {
    return `pull request #${options.number} was not found on ${options.repo.owner}/${options.repo.name}`;
  }

  if (transport === "ssh" && SSH_AUTH_FAILURE.test(stderr)) {
    const agent =
      process.env.SSH_AUTH_SOCK === undefined || process.env.SSH_AUTH_SOCK === ""
        ? " (the Daemon has no SSH agent: SSH_AUTH_SOCK is not set)"
        : "";

    return `ssh could not authenticate on this Host${agent}: ${stderr}`;
  }

  return `git fetch failed: ${stderr}`;
};

const isShallow = async (repoPath: string): Promise<boolean> =>
  (await checkoutGit(repoPath, ["rev-parse", "--is-shallow-repository"])) === "true";

const mergeBaseOf = async (repoPath: string, a: string, b: string): Promise<string | null> => {
  const result = await checkoutGitRaw(repoPath, ["merge-base", a, b]);

  return result.code === 0 ? decoder.decode(result.stdout).trim() : null;
};

const runFetch = async (
  repoPath: string,
  source: FetchSource,
  refspecs: ReadonlyArray<string>,
  options: { readonly unshallow: boolean; readonly timeoutMs: number }
): Promise<GitResult> =>
  checkoutGitRaw(
    repoPath,
    [
      ...NO_PROMPT_CONFIG,
      "fetch",
      ...FETCH_FLAGS,
      ...(options.unshallow ? ["--unshallow"] : []),
      source.source,
      ...refspecs,
    ],
    { env: { GIT_SSH_COMMAND: await batchSshCommand(repoPath) }, timeoutMs: options.timeoutMs }
  );

/**
 * The merge base in a shallow clone: fetch the code host's base commit by id
 * and try again. Missing still, the Review says it is a shallow clone.
 */
const shallowMergeBase = async (
  options: PullRequestFetch,
  source: FetchSource,
  head: string,
  timeoutMs: number
): Promise<string> => {
  const shallowClone = new CheckoutBlocked({
    blocker: ReviewCheckoutBlocker.cases.ShallowClone.make({}),
  });

  if (options.baseCommit === "") throw shallowClone;
  const target = reviewRef(options.key, "base-commit");

  const fetched = await runFetch(options.repoPath, source, [`+${options.baseCommit}:${target}`], {
    unshallow: false,
    timeoutMs,
  });

  if (fetched.code !== 0) throw shallowClone;
  const mergeBase = await mergeBaseOf(options.repoPath, target, head);

  if (mergeBase === null) throw shallowClone;

  return mergeBase;
};

/**
 * Fetch `refs/pull/<n>/head` and the base branch into the review refs; fails
 * with `CheckoutBlocked` (`FetchFailed` or `ShallowClone`) for the user to act on.
 */
export const fetchPullRequest = async (options: PullRequestFetch): Promise<Fetched> => {
  const { repoPath, key, number, baseRef } = options;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const source = await pickFetchSource(repoPath, options.repo);
  const shallow = await isShallow(repoPath);

  const result = await runFetch(
    repoPath,
    source,
    [
      `+refs/pull/${number}/head:${reviewRef(key, "head")}`,
      `+refs/heads/${baseRef}:${reviewRef(key, "base")}`,
    ],
    { unshallow: options.unshallow && shallow, timeoutMs }
  );

  if (result.code !== 0) {
    throw fetchFailed(describeFetchFailure(result, source.transport, { ...options, timeoutMs }));
  }

  const head = await checkoutGit(repoPath, ["rev-parse", "--verify", reviewRef(key, "head")]);
  const mergeBase = await mergeBaseOf(repoPath, reviewRef(key, "base"), head);

  if (mergeBase !== null) return { head, mergeBase };

  if (shallow && !options.unshallow) {
    return { head, mergeBase: await shallowMergeBase(options, source, head, timeoutMs) };
  }

  throw fetchFailed(`pull request #${number} shares no history with ${baseRef}`);
};

/**
 * An Agent Session's Review: its checkpoint commits, already in the
 * repository, get review refs of their own so pruning can't take them.
 */
export const pinCommits = async (options: {
  readonly repoPath: string;
  readonly key: string;
  readonly head: string;
  readonly base: string;
}): Promise<Fetched> => {
  const head = await resolveCommit(options.repoPath, options.head);
  const base = await resolveCommit(options.repoPath, options.base);

  if (head === null || base === null) {
    throw fetchFailed("the session's checkpoints are no longer in the repository");
  }

  await runGitRaw(options.repoPath, ["update-ref", "--stdin"], {
    stdin: `update ${reviewRef(options.key, "head")} ${head}\nupdate ${reviewRef(options.key, "base")} ${base}\n`,
  }).then((result) => {
    if (result.code !== 0) throw fetchFailed(`could not pin the checkpoints: ${result.stderr}`);
  });

  return { head, mergeBase: base };
};
