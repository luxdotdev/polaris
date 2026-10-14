/**
 * The Editor's status bar (DESIGN.md, Editor → Status bar): 26px, caption, on
 * surface-sunken. Left: the Host (latency when remote), branch, pull and
 * push, and change count; right: the editor's own part (position, language, vim mode).
 */
import { BranchIcon, cn } from "@polaris/ui";
import type { ReactNode } from "react";
import type { HostView } from "../../../../../shared/api.ts";
import type { Place } from "../data/actions.ts";
import type { GitFacts } from "../data/store.ts";
import { SyncStatus } from "./SyncStatus.tsx";
import { type SyncControls, useSync } from "./useSync.ts";

export interface StatusBarProps {
  readonly host: HostView;
  readonly place: Place;
  readonly git: GitFacts | "none" | null;
  readonly right: ReactNode;
}

const hostNote = (host: HostView): string | null => {
  const { state, latencyMs } = host.status;

  if (state === "reconnecting" || state === "offline") return state;

  return host.kind !== "local" && latencyMs !== null ? `${Math.round(latencyMs)} ms` : null;
};

/** Branch (or the detached commit), the sync item, and the change count. */
const GitItems = ({
  git,
  sync,
  away,
}: {
  readonly git: GitFacts;
  readonly sync: SyncControls | null;
  readonly away: boolean;
}) => (
  <>
    {git.branch === null && git.head === null ? null : (
      <span className="flex min-w-0 items-center gap-1.5" data-testid="status-branch">
        <BranchIcon size={12} className="shrink-0" />
        <span className="truncate">{git.branch ?? `Detached at ${git.head?.slice(0, 7)}`}</span>
        {sync === null && git.ahead > 0 ? <span>↑{git.ahead}</span> : null}
        {git.worktree ? <span>worktree</span> : null}
      </span>
    )}
    {sync === null ? null : (
      <span className={cn("flex min-w-0", away && "opacity-(--opacity-dimmed)")}>
        <SyncStatus controls={sync} />
      </span>
    )}
    <span data-testid="status-changed">
      {git.marks.changed > 0 ? `${git.marks.changed} changed` : "No changes"}
    </span>
  </>
);

export const StatusBar = ({ host, place, git, right }: StatusBarProps) => {
  const note = hostNote(host);
  const away = host.status.state !== "connected";
  const sync = useSync(place, host, git);

  return (
    <footer
      data-testid="editor-status-bar"
      className="border-hairline bg-surface-sunken text-caption text-text-subtle flex h-[26px] shrink-0 items-center gap-4 border-t px-3 tabular-nums"
    >
      <span className={cn("flex items-center gap-1.5", away && "opacity-(--opacity-dimmed)")}>
        <span className="bg-text-subtle size-1.5 rounded-full" />
        {host.label}
        {note === null ? null : <span className="ml-1">{note}</span>}
      </span>
      {git === null || git === "none" ? null : <GitItems git={git} sync={sync} away={away} />}
      <span className="flex-1" />
      {right}
    </footer>
  );
};
