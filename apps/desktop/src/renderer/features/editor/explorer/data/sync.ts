/**
 * Pull and push (capability `git.sync`): one run per explorer at a time. Each
 * step and the outcome land in the run; any end re-reads `git.status`.
 */
import type { GitSyncAction, GitSyncItem } from "@polaris/protocol";
import { Match } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { polaris } from "../../../bridge.ts";
import { IDLE_RUN, type SyncRun } from "../model/sync.ts";
import type { Place } from "./actions.ts";
import { refreshGit } from "./fetch.ts";

const runs = createStore<Readonly<Record<string, SyncRun>>>(() => ({}));

/** Closing a feed stops git on the Host. */
const closers = new Map<string, () => void>();

export const syncRunOf = (key: string): SyncRun => runs.getState()[key] ?? IDLE_RUN;

export const useSyncRun = (key: string): SyncRun => useStore(runs, (s) => s[key] ?? IDLE_RUN);

/** Tests and previews: put a run in place. */
export const setSyncRun = (key: string, run: SyncRun) =>
  runs.setState((s) => ({ ...s, [key]: run }));

const settle = (place: Place, run: SyncRun) => {
  closers.delete(place.key);
  setSyncRun(place.key, run);
  void refreshGit(place.key, place.hostKey, place.root);
};

const onItem = (place: Place, action: GitSyncAction, item: GitSyncItem) =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Step: ({ step, remote }) => {
        const current = syncRunOf(place.key);

        if (current.kind === "running") setSyncRun(place.key, { ...current, step, remote });
      },
      Done: () => settle(place, IDLE_RUN),
      Failed: ({ reason, exitCode, output }) =>
        settle(place, { kind: "failed", action, reason, exitCode, output }),
    })
  );

export const startSync = (place: Place, action: GitSyncAction) => {
  if (syncRunOf(place.key).kind === "running") return;
  setSyncRun(place.key, {
    kind: "running",
    action,
    step: null,
    remote: null,
    startedAt: Date.now(),
  });

  const close = polaris().subscribe(
    "git.sync",
    { hostKey: place.hostKey, cwd: place.root, action },
    {
      items: (items) => {
        for (const item of items) onItem(place, action, item);
      },
      end: (error) => {
        // Done or Failed already settled it; anything else is the feed ending under us.
        if (syncRunOf(place.key).kind !== "running") return;

        settle(
          place,
          error === null
            ? IDLE_RUN
            : {
                kind: "failed",
                action,
                reason: error.code === "GitError" ? "failed" : "lost",
                exitCode: null,
                output: error.message,
              }
        );
      },
    }
  );

  closers.set(place.key, close);
};

/** Stops the run: git is killed on the Host, and nothing is reported as failed. */
export const cancelSync = (place: Place) => {
  const close = closers.get(place.key);

  if (close === undefined) return;
  close();
  settle(place, IDLE_RUN);
};

export const dismissSync = (key: string) => {
  if (syncRunOf(key).kind === "failed") setSyncRun(key, IDLE_RUN);
};
