/**
 * `git.watch`: one item per burst of moves in git's own state for a checkout (the index,
 * HEAD, HEAD's reflog, packed refs). `files.watch` skips `.git`, and a linked worktree's
 * git dir isn't under its root at all, so staging, commits and checkouts need this feed.
 */
import { realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { GitError } from "@polaris/protocol";
import { Effect, Queue, Stream } from "effect";
import { subscribeDirectoryChanges } from "../files/watch.ts";
import { gitText } from "./git.ts";

/** Git dir entries whose change moves `git status`; `*.lock` files are git mid-write. */
const STATE = new Set([
  "index",
  "HEAD",
  "ORIG_HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "packed-refs",
  // A fetch from a terminal moves refs/remotes/*, which isn't watched: behind moves with it.
  "FETCH_HEAD",
]);

/** A commit or checkout writes several files within a few ms: one item for them all. */
export const SETTLE_MS = 50;

export interface GitDirs {
  /** This checkout's own: its index and HEAD (`.git/worktrees/<name>` for a linked one). */
  readonly gitDir: string;
  /** Shared by every worktree: refs and packed refs. */
  readonly commonDir: string;
}

export const gitDirsOf = async (cwd: string): Promise<GitDirs> => {
  const [gitDir = "", common = ""] = (
    await gitText(cwd, ["rev-parse", "--absolute-git-dir", "--git-common-dir"])
  ).split("\n");

  // `--git-common-dir` is relative to `cwd` in the main checkout.
  return { gitDir, commonDir: await realpath(resolve(cwd, common)) };
};

const tryWatch = (directory: string, changed: (path: string) => void) => {
  try {
    return subscribeDirectoryChanges(directory, changed);
  } catch {
    // A fresh repository has no `logs` until its first ref update.
    return null;
  }
};

/**
 * Calls `changed` when git's state moves; at most three shared, non-recursive directory
 * watches per git dir, released by the returned function. No timer or polling.
 */
export const watchGitState = (dirs: GitDirs, changed: () => void): (() => void) => {
  let logs: (() => void) | null = null;

  const armLogs = () => {
    logs ??= tryWatch(join(dirs.gitDir, "logs"), (path) => {
      if (basename(path) === "HEAD") changed();
    });
  };

  const own = subscribeDirectoryChanges(dirs.gitDir, (path) => {
    const name = basename(path);

    if (name === "logs") armLogs();

    // No name (or a watcher error) reports the directory itself: count it.
    if (path === dirs.gitDir || STATE.has(name)) changed();
  });

  const common =
    dirs.commonDir === dirs.gitDir
      ? null
      : tryWatch(dirs.commonDir, (path) => {
          if (basename(path) === "packed-refs") changed();
        });

  armLogs();

  return () => {
    own();
    common?.();
    logs?.();
  };
};

/** `git.watch` for `cwd`; fails when `cwd` isn't in a git checkout. */
export const watchGit = (cwd: string) =>
  Stream.unwrap(
    Effect.tryPromise({
      try: () => gitDirsOf(cwd),
      catch: (cause) =>
        new GitError({ cwd, message: cause instanceof Error ? cause.message : String(cause) }),
    }).pipe(
      Effect.map((dirs) =>
        Stream.callback<null>((queue) => {
          let settle: ReturnType<typeof setTimeout> | null = null;

          return Effect.acquireRelease(
            Effect.sync(() =>
              watchGitState(dirs, () => {
                settle ??= setTimeout(() => {
                  settle = null;
                  Queue.offerUnsafe(queue, null);
                }, SETTLE_MS);
              })
            ),
            (stop) =>
              Effect.sync(() => {
                stop();

                if (settle !== null) clearTimeout(settle);
              })
          );
        })
      )
    )
  );
