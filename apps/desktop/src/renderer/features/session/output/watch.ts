/**
 * Live file changes under a session's cwd (`files.watch`), as a tick that
 * bumps once per burst. The diff and the rail refetch on it, so Output shows
 * edits as they land, on this Mac or a remote Host.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";

/** A burst of writes (a formatter, a checkout) becomes one refetch. */
const SETTLE_MS = 250;

/** A remount (rail ↔ panel) keeps the feed instead of reopening it. */
const LINGER_MS = 2000;

interface Watch {
  users: number;
  /** The connection the feed is on; a newer one reopens it. */
  epoch: number;
  close: (() => void) | null;
  settle: ReturnType<typeof setTimeout> | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** Failed opens in a row, for the retry's backoff. */
  attempt: number;
  linger: ReturnType<typeof setTimeout> | null;
}

/**
 * Git's own writes don't count: `git status` refreshes the index and diffs
 * write objects, so counting them would refetch forever. HEAD's reflog moves
 * on commits and checkouts, which do change what Output shows.
 */
export const counts = (path: string) =>
  !(path.includes("/.git/") || path.startsWith(".git/")) || path.endsWith(".git/logs/HEAD");

/** 0.5 s, doubling, at most 8 s: a new Worktree appears within a second or two. */
export const retryDelay = (attempt: number) => Math.min(8000, 500 * 2 ** attempt);

const ticks = createStore<Readonly<Record<string, number>>>(() => ({}));

const watches = new Map<string, Watch>();

const watchKey = (hostKey: string, root: string) => `${hostKey}\u0000${root}`;

const bump = (key: string) => ticks.setState((t) => ({ ...t, [key]: (t[key] ?? 0) + 1 }));

const open = (key: string, watch: Watch, hostKey: string, root: string) => {
  watch.close?.();

  const close = polaris().subscribe(
    "files.watch",
    { hostKey, root },
    {
      items: (batches) => {
        watch.attempt = 0;

        if (!batches.some((batch) => batch.some((change) => counts(change.path)))) return;
        watch.settle ??= setTimeout(() => {
          watch.settle = null;
          bump(key);
        }, SETTLE_MS);
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

const acquire = (hostKey: string, root: string, epoch: number) => {
  const key = watchKey(hostKey, root);

  const watch = watches.get(key) ?? {
    users: 0,
    epoch,
    close: null,
    settle: null,
    retry: null,
    attempt: 0,
    linger: null,
  };

  watches.set(key, watch);
  watch.users++;

  if (watch.linger !== null) clearTimeout(watch.linger);
  watch.linger = null;

  if (watch.close === null || watch.epoch !== epoch) {
    if (watch.retry !== null) clearTimeout(watch.retry);
    watch.retry = null;
    watch.epoch = epoch;
    open(key, watch, hostKey, root);
    // Whatever changed while nobody watched shows now.
    bump(key);
  }

  return () => {
    watch.users--;

    if (watch.users > 0) return;
    watch.linger = setTimeout(() => {
      if (watch.users > 0) return;
      watch.close?.();

      if (watch.settle !== null) clearTimeout(watch.settle);

      if (watch.retry !== null) clearTimeout(watch.retry);
      watches.delete(key);
    }, LINGER_MS);
  };
};

/** The live connection's epoch: a new one means feeds must reopen. */
const useEpoch = (hostKey: string) =>
  useApp((s) => {
    const status = s.hosts.find((h) => h.key === hostKey)?.status;

    return status?.state === "connected" && status.capabilities.includes("files.watch")
      ? status.epoch
      : null;
  });

/** Bumps when files under `root` change; 0 while there's nothing to watch. */
export const useFilesTick = (hostKey: string, root: string | null): number => {
  const epoch = useEpoch(hostKey);
  const key = root === null ? "" : watchKey(hostKey, root);

  useEffect(() => {
    if (root === null || root === "" || epoch === null) return undefined;

    return acquire(hostKey, root, epoch);
  }, [hostKey, root, epoch]);

  return useStore(ticks, (t) => t[key] ?? 0);
};
