/** The sync controls' view and actions for one explorer, shared by the changes tab and the status bar. */
import type { GitSyncAction } from "@polaris/protocol";
import type { HostView } from "../../../../../shared/api.ts";
import { openTerminalIn } from "../../../terminal/index.ts";
import type { Place } from "../data/actions.ts";
import { patchExplorer, type GitFacts } from "../data/store.ts";
import { cancelSync, dismissSync, startSync, useSyncRun } from "../data/sync.ts";
import { type SyncNext, type SyncView, syncView } from "../model/sync.ts";

export interface SyncControls {
  readonly view: SyncView;
  readonly startedAt: number | null;
  readonly run: (action: GitSyncAction) => void;
  readonly cancel: () => void;
  readonly dismiss: () => void;
  readonly next: (next: SyncNext) => void;
  readonly showChanges: () => void;
}

/** Null where the Daemon can't sync (no `git.sync`) or outside git. */
export const useSync = (
  place: Place,
  host: HostView,
  git: GitFacts | "none" | null
): SyncControls | null => {
  const run = useSyncRun(place.key);

  if (git === null || git === "none" || !host.status.capabilities.includes("git.sync")) return null;
  const view = syncView({ facts: git, run, host: host.label, connection: host.status.state });

  if (view === null) return null;
  const showChanges = () => patchExplorer(place.key, () => ({ view: "changes" }));
  const start = (action: GitSyncAction) => startSync(place, action);

  return {
    view,
    startedAt: run.kind === "running" ? run.startedAt : null,
    run: start,
    cancel: () => cancelSync(place),
    dismiss: () => dismissSync(place.key),
    showChanges,
    next: (next) => {
      if (next.kind === "action") start(next.action);
      else if (next.kind === "changes") showChanges();
      else void openTerminalIn(place, git.toplevel);
    },
  };
};
