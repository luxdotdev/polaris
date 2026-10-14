/**
 * Live changes under a session's cwd or a Workspace, as a tick that bumps once per burst:
 * the files (`files.watch`) and git's own state (`git.watch`: staging, commits, checkouts,
 * from any terminal or agent). Output, the rail and the explorer refetch on it.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";

/** A burst of writes (a formatter, a checkout) becomes one refetch. */
export const SETTLE_MS = 250;

/** A remount (rail ↔ panel) keeps the feed instead of reopening it. */
const LINGER_MS = 2000;

interface Watch {
  users: number;
  /** The connection the feed is on; a newer one reopens it. */
  epoch: number;
  /** The Host announces `git.watch`; older Daemons have only the files feed. */
  git: boolean;
  close: (() => void) | null;
  closeGit: (() => void) | null;
  settle: ReturnType<typeof setTimeout> | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** Failed opens in a row, for the retry's backoff. */
  attempt: number;
  linger: ReturnType<typeof setTimeout> | null;
}

/**
 * Git's own writes don't count here: `git status` refreshes the index and diffs
 * write objects, so counting them would refetch forever (`git.watch` covers git's
 * state). HEAD's reflog moves on commits and checkouts, for Daemons without it.
 */
export const counts = (path: string) =>
  !(path.includes("/.git/") || path.startsWith(".git/")) || path.endsWith(".git/logs/HEAD");

/** 0.5 s, doubling, at most 8 s: a new Worktree appears within a second or two. */
export const retryDelay = (attempt: number) => Math.min(8000, 500 * 2 ** attempt);

const ticks = createStore<Readonly<Record<string, number>>>(() => ({}));

const watches = new Map<string, Watch>();

const watchKey = (hostKey: string, root: string) => `${hostKey}\u0000${root}`;

const bump = (key: string) => ticks.setState((t) => ({ ...t, [key]: (t[key] ?? 0) + 1 }));

const schedule = (key: string, watch: Watch) => {
  watch.settle ??= setTimeout(() => {
    watch.settle = null;
    bump(key);
  }, SETTLE_MS);
};

/** Git's feed ends quietly outside a repository; the files feed's reopen reopens it too. */
const openGit = (key: string, watch: Watch, hostKey: string, root: string) => {
  watch.closeGit?.();
  watch.closeGit = null;

  if (!watch.git) return;

  const close = polaris().subscribe(
    "git.watch",
    { hostKey, cwd: root },
    {
      items: () => schedule(key, watch),
      end: () => {
        if (watch.closeGit === close) watch.closeGit = null;
      },
    }
  );

  watch.closeGit = close;
};

const open = (key: string, watch: Watch, hostKey: string, root: string) => {
  watch.close?.();
  openGit(key, watch, hostKey, root);

  const close = polaris().subscribe(
    "files.watch",
    { hostKey, root },
    {
      items: (batches) => {
        watch.attempt = 0;

        if (batches.some((batch) => batch.some((change) => counts(change.path))))
          schedule(key, watch);
      },
      // Ending with its connection, the epoch effect below reopens it. An error
      // (the Worktree isn't there yet) retries, and the reopen refetches.
      end: (error) => {
        if (watch.close !== close) return;
        watch.close = null;

        if (error === null || watch.users === 0) return;
        watch.retry = setTimeout(() => {
          watch.retry = null;

          if (watch.users === 0 || watch.close !== null) return;
          watch.attempt++;
          open(key, watch, hostKey, root);
          bump(key);
        }, retryDelay(watch.attempt));
      },
    }
  );

  watch.close = close;
};

const release = (key: string, watch: Watch) => {
  watch.close?.();
  watch.closeGit?.();

  if (watch.settle !== null) clearTimeout(watch.settle);

  if (watch.retry !== null) clearTimeout(watch.retry);
  watches.delete(key);
};

/** Holds the feeds for `root` while the returned release is uncalled; shared across users. */
export const acquireWatch = (hostKey: string, root: string, epoch: number, git: boolean) => {
  const key = watchKey(hostKey, root);

  const watch = watches.get(key) ?? {
    users: 0,
    epoch,
    git,
    close: null,
    closeGit: null,
    settle: null,
    retry: null,
    attempt: 0,
    linger: null,
  };

  watches.set(key, watch);
  watch.users++;

  if (watch.linger !== null) clearTimeout(watch.linger);
  watch.linger = null;

  if (watch.close === null || watch.epoch !== epoch || watch.git !== git) {
    if (watch.retry !== null) clearTimeout(watch.retry);
    watch.retry = null;
    watch.epoch = epoch;
    watch.git = git;
    open(key, watch, hostKey, root);
    // Whatever changed while nobody watched shows now.
    bump(key);
  }

  return () => {
    watch.users--;

    if (watch.users > 0) return;
    watch.linger = setTimeout(() => {
      if (watch.users === 0) release(key, watch);
    }, LINGER_MS);
  };
};

/** The tick `useFilesTick` returns, outside React. */
export const filesTick = (hostKey: string, root: string) =>
  ticks.getState()[watchKey(hostKey, root)] ?? 0;

/** The live connection's epoch: a new one means feeds must reopen. */
const useEpoch = (hostKey: string) =>
  useApp((s) => {
    const status = s.hosts.find((h) => h.key === hostKey)?.status;

    return status?.state === "connected" && status.capabilities.includes("files.watch")
      ? status.epoch
      : null;
  });

const useGitWatch = (hostKey: string) =>
  useApp(
    (s) =>
      s.hosts.find((h) => h.key === hostKey)?.status.capabilities.includes("git.watch") === true
  );

/** Bumps when files or git's state under `root` change; 0 while there's nothing to watch. */
export const useFilesTick = (hostKey: string, root: string | null): number => {
  const epoch = useEpoch(hostKey);
  const git = useGitWatch(hostKey);
  const key = root === null ? "" : watchKey(hostKey, root);

  useEffect(() => {
    if (root === null || root === "" || epoch === null) return undefined;

    return acquireWatch(hostKey, root, epoch, git);
  }, [hostKey, root, epoch, git]);

  return useStore(ticks, (t) => t[key] ?? 0);
};
