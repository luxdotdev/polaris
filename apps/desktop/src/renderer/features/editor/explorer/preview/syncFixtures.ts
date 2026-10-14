/** `#explorer/sync-*`: the branch's standing and the last run, one scene per state of the sync controls. */
import type { GitTracking } from "@polaris/protocol";
import type { SyncRun } from "../model/sync.ts";

export const SYNC_SCENES = [
  "sync-diverged",
  "sync-behind",
  "sync-publish",
  "sync-running",
  "sync-rejected",
  "sync-conflicts",
  "sync-auth",
  "sync-detached",
  "sync-no-remote",
  "sync-reconnecting",
] as const;

export type SyncScene = (typeof SYNC_SCENES)[number];

interface SyncFixture {
  readonly branch: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly tracking: GitTracking;
  readonly run: SyncRun;
  readonly reconnecting?: boolean;
}

const MAIN: GitTracking = { upstream: "origin/main", gone: false, remote: null };

const BRANCH = "lucas/eng-169-research-herdr-dagrs-dag-model";

const failed = (
  action: "pull" | "push" | "sync" | "fetch",
  reason: "rejected" | "conflicts" | "auth",
  output: string
): SyncRun => ({ kind: "failed", action, reason, exitCode: reason === "auth" ? 128 : 1, output });

export const SYNC: Record<SyncScene, SyncFixture> = {
  "sync-diverged": { branch: "main", ahead: 3, behind: 2, tracking: MAIN, run: { kind: "idle" } },
  "sync-behind": { branch: "main", ahead: 0, behind: 12, tracking: MAIN, run: { kind: "idle" } },
  "sync-publish": {
    branch: BRANCH,
    ahead: 0,
    behind: 0,
    tracking: { upstream: null, gone: false, remote: "origin" },
    run: { kind: "idle" },
  },
  "sync-running": {
    branch: "main",
    ahead: 3,
    behind: 2,
    tracking: MAIN,
    run: {
      kind: "running",
      action: "sync",
      step: "pull",
      remote: "origin",
      startedAt: Date.now() - 4000,
    },
  },
  "sync-rejected": {
    branch: "main",
    ahead: 1,
    behind: 0,
    tracking: MAIN,
    run: failed(
      "push",
      "rejected",
      "To github.com:polaris/polaris.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'github.com:polaris/polaris.git'"
    ),
  },
  "sync-conflicts": {
    branch: "main",
    ahead: 2,
    behind: 0,
    tracking: MAIN,
    run: failed(
      "pull",
      "conflicts",
      "Auto-merging daemon/src/hosts/reconnect.ts\nCONFLICT (content): Merge conflict in daemon/src/hosts/reconnect.ts\nAutomatic merge failed; fix conflicts and then commit the result."
    ),
  },
  "sync-auth": {
    branch: "main",
    ahead: 1,
    behind: 0,
    tracking: MAIN,
    run: failed(
      "fetch",
      "auth",
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."
    ),
  },
  "sync-detached": {
    branch: null,
    ahead: 0,
    behind: 0,
    tracking: { upstream: null, gone: false, remote: "origin" },
    run: { kind: "idle" },
  },
  "sync-no-remote": {
    branch: "main",
    ahead: 0,
    behind: 0,
    tracking: { upstream: null, gone: false, remote: null },
    run: { kind: "idle" },
  },
  "sync-reconnecting": {
    branch: "main",
    ahead: 3,
    behind: 2,
    tracking: MAIN,
    run: { kind: "idle" },
    reconnecting: true,
  },
};
