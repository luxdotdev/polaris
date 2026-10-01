/**
 * Names shared by the Review Checkout git code: its refs under
 * `refs/polaris/review/<key>/`, the worktree lock reason, and the hooks-off
 * switch every git call in a checkout carries.
 */
import { GitCommandError, type GitOptions, type GitResult, runGitRaw } from "../git.ts";

export const REVIEW_REF_PREFIX = "refs/polaris/review/";

/**
 * - `head` / `base`: the latest fetched PR head and base branch tip.
 * - `base-commit`: the code host's base commit, fetched by id for a shallow clone.
 * - `reviewed` / `reviewed-base`: the head the last Risk Summary covered, and its merge base.
 */
export type ReviewRefName = "head" | "base" | "base-commit" | "reviewed" | "reviewed-base";

export const REVIEW_REF_NAMES: ReadonlyArray<ReviewRefName> = [
  "head",
  "base",
  "base-commit",
  "reviewed",
  "reviewed-base",
];

/** `<number>` for a pull request, `session-<id>` for an Agent Session's Turns. */
export const reviewRef = (key: string, name: ReviewRefName): string =>
  `${REVIEW_REF_PREFIX}${key}/${name}`;

/** Every lock reason Polaris writes starts with this; `WorktreeTracker` users recognise it. */
export const LOCK_REASON_PREFIX = "polaris review checkout";

export const lockReasonFor = (label: string): string => `${LOCK_REASON_PREFIX} ${label}`;

/**
 * A PR can ship a hook its own relative `core.hooksPath` points at (husky):
 * no Polaris git call in a checkout may run it (docs/research/review-checkout.md §3).
 */
export const HOOKS_OFF: ReadonlyArray<string> = ["-c", "core.hooksPath=/dev/null"];

/** git in a Review Checkout (or on its behalf), hooks off. */
export const checkoutGitRaw = (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {}
): Promise<GitResult> => runGitRaw(cwd, [...HOOKS_OFF, ...args], options);

const decoder = new TextDecoder();

/** `checkoutGitRaw` that rejects on failure and returns trimmed stdout. */
export const checkoutGit = async (
  cwd: string,
  args: ReadonlyArray<string>,
  options: GitOptions = {}
): Promise<string> => {
  const full = [...HOOKS_OFF, ...args];
  const result = await runGitRaw(cwd, full, options);

  if (result.code !== 0 && !(options.okCodes?.includes(result.code) ?? false)) {
    throw new GitCommandError(cwd, full, result.code, result.stderr);
  }

  return decoder.decode(result.stdout).replace(/\n$/, "");
};
