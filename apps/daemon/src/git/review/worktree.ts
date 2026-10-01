/**
 * The Review Checkout's worktree: a detached, locked worktree created,
 * inspected, moved and removed with hooks off (docs/research/review-checkout.md
 * §3–5). Nothing here forces: a dirty checkout or one with commits of its own
 * is reported, never overwritten, unless the user chose to discard.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorktreeInfo } from "../../services.ts";
import { createWorktree, listWorktrees, samePath } from "../WorktreeTracker.ts";
import { checkoutGit, checkoutGitRaw, LOCK_REASON_PREFIX, REVIEW_REF_PREFIX } from "./refs.ts";

const findWorktree = async (repoPath: string, path: string): Promise<WorktreeInfo | undefined> =>
  (await listWorktrees(repoPath)).find((w) => samePath(w.path, resolve(repoPath, path)));

/** Whether a listed worktree is a Review Checkout, by its lock reason. */
export const isReviewCheckoutWorktree = (worktree: WorktreeInfo): boolean =>
  worktree.lockReason?.startsWith(LOCK_REASON_PREFIX) ?? false;

/** Unlock and forget a registered worktree whose directory is gone (deleted by hand). */
const pruneMissing = async (repoPath: string, path: string): Promise<void> => {
  await checkoutGitRaw(repoPath, ["worktree", "unlock", path]);
  await checkoutGit(repoPath, ["worktree", "prune"]);
};

/**
 * The checkout at `path` on `head`, detached and locked. Idempotent: a
 * checkout already registered there (a Daemon restart mid-create) is kept as it is.
 */
export const ensureCheckout = async (options: {
  readonly repoPath: string;
  readonly path: string;
  readonly head: string;
  readonly lockReason: string;
}): Promise<void> => {
  const { repoPath, path, head, lockReason } = options;
  const existing = await findWorktree(repoPath, path);

  if (existing !== undefined && existsSync(path)) return;

  if (existing !== undefined) await pruneMissing(repoPath, path);
  await createWorktree({ repoPath, path, detach: head, config: ["core.hooksPath=/dev/null"] });
  await checkoutGit(repoPath, ["worktree", "lock", "--reason", lockReason, path]);
};

export interface CheckoutInspection {
  /** Whether the worktree is there at all. */
  readonly present: boolean;
  /** Modified and untracked paths (ignored files don't count). */
  readonly dirtyPaths: ReadonlyArray<string>;
  /** Commits on the detached HEAD that nothing else (a branch, tag, remote or Polaris ref) holds. */
  readonly localCommits: number;
}

const parsePorcelainPaths = (output: string): Array<string> => {
  const paths: Array<string> = [];
  const fields = output.split("\0");

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";

    if (field.length < 4) continue;
    paths.push(field.slice(3));

    // A rename or copy is followed by its source path.
    if (field[0] === "R" || field[0] === "C") i++;
  }

  return paths;
};

/** What blocks moving or removing the checkout, as it is on disk now. */
export const inspectCheckout = async (path: string): Promise<CheckoutInspection> => {
  if (!existsSync(path)) return { present: false, dirtyPaths: [], localCommits: 0 };

  const status = await checkoutGit(path, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
  ]);

  const count = await checkoutGitRaw(path, [
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    "--branches",
    "--tags",
    "--remotes",
    `--glob=${REVIEW_REF_PREFIX}*`,
    "--glob=refs/polaris/checkpoints/*",
  ]);

  const localCommits =
    count.code === 0 ? Number.parseInt(new TextDecoder().decode(count.stdout).trim(), 10) : 0;

  return {
    present: true,
    dirtyPaths: parsePorcelainPaths(status),
    localCommits: Number.isFinite(localCommits) ? localCommits : 0,
  };
};

/** Move a clean checkout to `head`; with `discardChanges` its edits and untracked files go first. */
export const moveCheckout = async (options: {
  readonly path: string;
  readonly head: string;
  readonly discardChanges: boolean;
}): Promise<void> => {
  const { path, head, discardChanges } = options;

  if (discardChanges) {
    await checkoutGit(path, ["reset", "-q", "--hard"]);
    // Not `-x`: ignored files (installed dependencies) stay.
    await checkoutGit(path, ["clean", "-fdq"]);
  }

  await checkoutGit(path, ["checkout", "-q", "--detach", head]);
};

/** The review refs of one checkout that exist. */
const reviewRefsOf = async (repoPath: string, key: string): Promise<Array<string>> => {
  const out = await checkoutGit(repoPath, [
    "for-each-ref",
    "--format=%(refname)",
    `${REVIEW_REF_PREFIX}${key}/`,
  ]);

  return out === "" ? [] : out.split("\n");
};

/** Delete a checkout's review refs in one transaction. */
export const deleteReviewRefs = async (repoPath: string, key: string): Promise<void> => {
  const refs = await reviewRefsOf(repoPath, key);

  if (refs.length === 0) return;
  await checkoutGit(repoPath, ["update-ref", "--stdin"], {
    stdin: `${refs.map((ref) => `delete ${ref}`).join("\n")}\n`,
  });
};

/**
 * Remove the worktree (never `--force`; the caller checked it is clean and
 * holds no commits of its own) and its refs. A removal git refuses is locked again.
 */
export const removeCheckout = async (options: {
  readonly repoPath: string;
  readonly path: string;
  readonly key: string;
}): Promise<void> => {
  const { repoPath, path, key } = options;
  const worktree = await findWorktree(repoPath, path);

  if (worktree !== undefined && !existsSync(path)) {
    await pruneMissing(repoPath, path);
  } else if (worktree !== undefined) {
    await checkoutGitRaw(repoPath, ["worktree", "unlock", path]);
    const removed = await checkoutGitRaw(repoPath, ["worktree", "remove", path]);

    if (removed.code !== 0) {
      await checkoutGitRaw(repoPath, [
        "worktree",
        "lock",
        "--reason",
        worktree.lockReason ?? LOCK_REASON_PREFIX,
        path,
      ]);
      throw new Error(`git worktree remove failed: ${removed.stderr.trim()}`);
    }
  }

  await deleteReviewRefs(repoPath, key);
};
