/**
 * Every git worktree of a repository, wherever it lives on disk. git's own
 * registry (`git worktree list --porcelain`) is the source of truth; the
 * watcher only tells us when to re-read it.
 */
import { existsSync, type FSWatcher, watch as fsWatch, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Cause, Effect, Layer, Queue, Stream } from "effect";
import { ServiceError, type WorktreeInfo, WorktreeTracker } from "../services.ts";
import { gitText, runGitRaw } from "./git.ts";

/** How long the registry must be quiet before it is re-read. */
export const WATCH_DEBOUNCE_MS = 150;

/** Safety net: re-read this often even without file-system events (fs events can be dropped). */
export const WATCH_POLL_MS = 30_000;

interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  lockReason: string | null;
}

/** One `key value` field of a worktree record. */
const applyField = (record: WorktreeRecord, key: string, value: string) => {
  if (key === "HEAD") record.head = value;
  else if (key === "branch") record.branch = value.replace(/^refs\/heads\//, "");
  else if (key === "bare") record.bare = true;
  else if (key === "locked") record.lockReason = value;
};

const toInfo = (record: WorktreeRecord, isMain: boolean): WorktreeInfo => {
  const info: WorktreeInfo = {
    path: record.path,
    branch: record.branch,
    head: record.head,
    isMain,
  };

  if (record.lockReason === null) return info;

  return { ...info, lockReason: record.lockReason };
};

/** Parses `git worktree list --porcelain -z`. The first record is the main worktree. */
export const parseWorktreeList = (output: string): Array<WorktreeInfo> => {
  const worktrees: Array<WorktreeInfo> = [];
  let current: WorktreeRecord | null = null;

  const flush = () => {
    if (current !== null && !current.bare) {
      worktrees.push(toInfo(current, worktrees.length === 0));
    } else if (current?.bare) {
      // A bare main repository has no working tree; keep the "first is main" rule for the rest.
      worktrees.length = 0;
    }

    current = null;
  };

  for (const field of output.split("\0")) {
    if (field === "") {
      flush();
      continue;
    }

    const space = field.indexOf(" ");
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? "" : field.slice(space + 1);

    if (key === "worktree") {
      flush();
      current = { path: value, head: "", branch: null, bare: false, lockReason: null };
    } else if (current !== null) {
      applyField(current, key, value);
    }
  }

  flush();

  return worktrees;
};

export const listWorktrees = async (repoPath: string): Promise<Array<WorktreeInfo>> =>
  parseWorktreeList(await gitText(repoPath, ["worktree", "list", "--porcelain", "-z"]));

const canonical = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export const samePath = (a: string, b: string): boolean => canonical(a) === canonical(b);

/** A new branch Worktree, or (with `detach`) a detached one at a commit, as a Review Checkout is. */
export type CreateWorktreeOptions =
  | {
      readonly repoPath: string;
      readonly path: string;
      readonly branch: string;
      readonly baseRef: string | null;
    }
  | {
      readonly repoPath: string;
      readonly path: string;
      /** The commit to check out with a detached HEAD; no branch is created. */
      readonly detach: string;
      /** Extra `-c` settings for `worktree add`, e.g. `core.hooksPath=/dev/null`. */
      readonly config?: ReadonlyArray<string>;
    };

const worktreeAddArgs = async (options: CreateWorktreeOptions): Promise<Array<string>> => {
  if ("detach" in options) {
    const config = (options.config ?? []).flatMap((setting) => ["-c", setting]);

    return [...config, "worktree", "add", "--detach", options.path, options.detach];
  }

  const { repoPath, path, branch, baseRef } = options;

  const exists =
    (await runGitRaw(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]))
      .code === 0;

  return exists
    ? // An existing branch is checked out as-is (git refuses if it is checked out elsewhere).
      ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, ...(baseRef === null ? [] : [baseRef])];
};

export const createWorktree = async (options: CreateWorktreeOptions): Promise<WorktreeInfo> => {
  const { repoPath, path } = options;
  await mkdir(dirname(resolve(repoPath, path)), { recursive: true });
  await gitText(repoPath, await worktreeAddArgs(options));

  const created = (await listWorktrees(repoPath)).find((w) =>
    samePath(w.path, resolve(repoPath, path))
  );

  if (created === undefined) throw new Error(`worktree ${path} was not registered by git`);

  return created;
};

/**
 * Removes a worktree. Its branch is kept unless `deleteBranchIfMerged` and the
 * branch is merged into the main worktree's HEAD; an unmerged branch is never
 * deleted (`git branch -d`, never `-D`). A dirty worktree is not removed
 * (no `--force`): git's error is returned instead.
 */
export const removeWorktree = async (options: {
  readonly repoPath: string;
  readonly path: string;
  readonly deleteBranchIfMerged: boolean;
}): Promise<{ readonly branchDeleted: boolean }> => {
  const { repoPath, path, deleteBranchIfMerged } = options;
  const worktrees = await listWorktrees(repoPath);
  const target = worktrees.find((w) => samePath(w.path, resolve(repoPath, path)));

  if (target === undefined) throw new Error(`not a worktree of ${repoPath}: ${path}`);

  if (target.isMain) throw new Error("the main worktree cannot be removed");
  const main = worktrees.find((w) => w.isMain);
  const mainPath = main?.path ?? repoPath;
  await gitText(mainPath, ["worktree", "remove", target.path]);

  if (!deleteBranchIfMerged || target.branch === null) return { branchDeleted: false };

  const merged =
    (
      await runGitRaw(mainPath, [
        "merge-base",
        "--is-ancestor",
        `refs/heads/${target.branch}`,
        "HEAD",
      ])
    ).code === 0;

  if (!merged) return { branchDeleted: false };
  // `-d` re-checks mergedness itself, so an unmerged branch can never be lost here.
  const deleted = await runGitRaw(mainPath, ["branch", "-d", target.branch]);

  return { branchDeleted: deleted.code === 0 };
};

const commonDir = (repoPath: string): Promise<string> =>
  gitText(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

const toServiceError = (cause: unknown) =>
  new ServiceError({
    service: "WorktreeTracker",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const attempt = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: toServiceError });

/**
 * Emits the list at once, then again whenever it changes. Watches the common
 * git dir (for `worktrees/` appearing and the main HEAD) and `worktrees/`
 * recursively (per-worktree HEAD, locks, removal), debounced, plus a slow poll.
 */
export const watchWorktrees = (
  repoPath: string
): Stream.Stream<ReadonlyArray<WorktreeInfo>, ServiceError> =>
  Stream.callback<ReadonlyArray<WorktreeInfo>, ServiceError>((queue) =>
    Effect.gen(function* () {
      const common = yield* attempt(() => commonDir(repoPath));
      const worktreesDir = join(common, "worktrees");
      let last = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let running = false;
      let again = false;
      let closed = false;
      const watchers = new Map<string, FSWatcher>();

      const refresh = async () => {
        if (running) {
          again = true;

          return;
        }

        running = true;

        try {
          do {
            again = false;
            const list = await listWorktrees(repoPath);
            const key = JSON.stringify(list);

            if (key !== last && !closed) {
              last = key;
              Queue.offerUnsafe(queue, list);
            }
          } while (again && !closed);
        } catch (cause) {
          if (!closed) Queue.failCauseUnsafe(queue, Cause.fail(toServiceError(cause)));
        } finally {
          running = false;
        }
      };

      const schedule = () => {
        if (closed) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          armWorktreesDir();
          void refresh();
        }, WATCH_DEBOUNCE_MS);
      };

      const arm = (path: string, recursive: boolean) => {
        if (watchers.has(path) || !existsSync(path)) return;

        try {
          const watcher = fsWatch(path, { recursive }, schedule);
          watcher.on("error", () => {
            watcher.close();
            watchers.delete(path);
            schedule();
          });
          watchers.set(path, watcher);
        } catch {
          // The directory vanished between the check and the watch; the poll covers it.
        }
      };

      const armWorktreesDir = () => {
        const existing = watchers.get(worktreesDir);

        if (existing !== undefined && !existsSync(worktreesDir)) {
          existing.close();
          watchers.delete(worktreesDir);
        }

        arm(worktreesDir, true);
      };

      arm(common, false);
      armWorktreesDir();
      const poll = setInterval(schedule, WATCH_POLL_MS);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
          clearTimeout(timer);
          clearInterval(poll);

          for (const watcher of watchers.values()) watcher.close();
          watchers.clear();
        })
      );
      yield* attempt(refresh);
    })
  );

export const WorktreeTrackerLive = Layer.succeed(
  WorktreeTracker,
  WorktreeTracker.of({
    list: (repoPath) => attempt(() => listWorktrees(repoPath)),
    watch: watchWorktrees,
    create: (options) => attempt(() => createWorktree(options)),
    remove: (options) => attempt(() => removeWorktree(options)).pipe(Effect.asVoid),
  })
);
