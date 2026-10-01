/**
 * "Only the new changes" after an update: the PR as last reviewed, replayed
 * onto its new merge base, compared with the new head
 * (docs/research/review-checkout.md §4). `merge-tree --merge-base` needs git
 * 2.40; older gits, and conflicts, replay with a private index.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutGit, checkoutGitRaw, reviewRef } from "./refs.ts";

export interface InterdiffInput {
  readonly repoPath: string;
  /** The head and merge base the last Risk Summary covered. */
  readonly reviewed: string;
  readonly reviewedBase: string;
  /** The new head, and the base branch tip it is compared against. */
  readonly head: string;
  readonly base: string;
  /** Skip `merge-tree` (tests of the git < 2.40 path). */
  readonly forceFallback?: boolean;
}

/**
 * What to diff the new head against: `from` (a commit or a tree), or null
 * when only a full Risk Summary will do, with the `reason` the user reads.
 */
export interface Interdiff {
  readonly from: string | null;
  readonly fastForward: boolean;
  readonly mergeBase: string;
  readonly reason: string | null;
}

const decoder = new TextDecoder();

const isAncestor = async (repoPath: string, a: string, b: string): Promise<boolean> =>
  (await checkoutGitRaw(repoPath, ["merge-base", "--is-ancestor", a, b])).code === 0;

/** `merge-tree --write-tree --merge-base`: the tree, or null on a conflict or an old git. */
const replayWithMergeTree = async (
  repoPath: string,
  reviewedBase: string,
  mergeBase: string,
  reviewed: string
): Promise<string | null> => {
  const result = await checkoutGitRaw(repoPath, [
    "merge-tree",
    "--write-tree",
    `--merge-base=${reviewedBase}`,
    mergeBase,
    reviewed,
  ]);

  if (result.code !== 0) return null;

  return decoder.decode(result.stdout).split("\n")[0]?.trim() || null;
};

/** The same replay through a throwaway index: `read-tree`, `apply --cached --3way`, `write-tree`. */
const replayWithIndex = async (
  repoPath: string,
  reviewedBase: string,
  mergeBase: string,
  reviewed: string
): Promise<string | null> => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-interdiff-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };

  try {
    await checkoutGit(repoPath, ["read-tree", mergeBase], { env });
    const patch = await checkoutGitRaw(repoPath, ["diff", "--binary", reviewedBase, reviewed]);

    if (patch.code !== 0) return null;

    if (patch.stdout.byteLength > 0) {
      const applied = await checkoutGitRaw(repoPath, ["apply", "--cached", "--3way"], {
        env,
        stdin: patch.stdout,
      });

      if (applied.code !== 0) return null;
    }

    return await checkoutGit(repoPath, ["write-tree"], { env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const interdiff = async (input: InterdiffInput): Promise<Interdiff> => {
  const { repoPath, reviewed, reviewedBase, head, base } = input;
  const mergeBase = await checkoutGit(repoPath, ["merge-base", base, head]);

  if (mergeBase === reviewedBase && (await isAncestor(repoPath, reviewed, head))) {
    return { from: reviewed, fastForward: true, mergeBase, reason: null };
  }

  const tree =
    (input.forceFallback
      ? null
      : await replayWithMergeTree(repoPath, reviewedBase, mergeBase, reviewed)) ??
    (await replayWithIndex(repoPath, reviewedBase, mergeBase, reviewed));

  return tree === null
    ? {
        from: null,
        fastForward: false,
        mergeBase,
        reason: "the pull request was rebased over conflicting changes",
      }
    : { from: tree, fastForward: false, mergeBase, reason: null };
};

/** Record the head a Risk Summary covered (`reviewed`, `reviewed-base`) in one transaction. */
export const markReviewed = async (options: {
  readonly repoPath: string;
  readonly key: string;
  readonly head: string;
  readonly mergeBase: string;
}): Promise<void> => {
  const { repoPath, key, head, mergeBase } = options;
  await checkoutGit(repoPath, ["update-ref", "--stdin"], {
    stdin: `update ${reviewRef(key, "reviewed")} ${head}\nupdate ${reviewRef(key, "reviewed-base")} ${mergeBase}\n`,
  });
};
