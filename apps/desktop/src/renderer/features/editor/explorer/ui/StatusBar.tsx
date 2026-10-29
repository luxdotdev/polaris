/**
 * The Editor's status row (DESIGN.md, Chrome redesign → Editor): the editor card's foot, or its
 * own strip under the terminal. Left: the Host (latency when remote), branch, pull and push, and
 * change count; right: the editor's own part. The branch shrinks in the middle, then the Host name.
 */
import { BranchIcon, cn } from "@polaris/ui";
import { type ReactNode, useRef } from "react";
import {
  CompletionsFit,
  FIT_BRANCH,
  FIT_HOST,
  FIT_SPACER,
  FIT_YIELDS,
  StatusDrops,
  useStatusFit,
} from "../../ui/useStatusFit.ts";
import type { StatusDrop } from "../../ui/statusFit.ts";
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
const branchText = (git: GitFacts | "none" | null) => {
  if (git === null || git === "none" || (git.branch === null && git.head === null)) return null;

  return git.branch ?? `Detached at ${git.head?.slice(0, 7)}`;
};

const GitItems = ({
  git,
  sync,
  away,
  branch,
  drops,
}: {
  readonly git: GitFacts;
  readonly sync: SyncControls | null;
  readonly away: boolean;
  /** The branch as it fits, middle-truncated; null without one. */
  readonly branch: { readonly full: string; readonly shown: string } | null;
  readonly drops: ReadonlyArray<StatusDrop>;
}) => (
  <>
    {branch === null ? null : (
      <span
        className="flex shrink-0 items-center gap-1.5"
        data-testid="status-branch"
        title={branch.shown === branch.full ? undefined : branch.full}
      >
        <BranchIcon size={12} className="shrink-0" />
        <span data-fit={FIT_BRANCH} className="min-w-0 overflow-hidden whitespace-nowrap">
          {branch.shown}
        </span>
        {sync === null && git.ahead > 0 ? <span className="shrink-0">↑{git.ahead}</span> : null}
        {git.worktree ? <span className="shrink-0">worktree</span> : null}
      </span>
    )}
    {sync === null ? null : (
      <span className={cn("flex shrink-0", away && "opacity-(--opacity-dimmed)")}>
        <SyncStatus controls={sync} counts={!drops.includes("sync-counts")} />
      </span>
    )}
    {/* Truncates first once the fit has nothing left, then the editor's cursor text. */}
    <span
      data-testid="status-changed"
      data-fit={FIT_YIELDS}
      className="min-w-0 shrink-1000 truncate"
    >
      {git.marks.changed > 0 ? `${git.marks.changed} changed` : "No changes"}
    </span>
  </>
);

export const StatusBar = ({ host, place, git, right }: StatusBarProps) => {
  const note = hostNote(host);
  const away = host.status.state !== "connected";
  const sync = useSync(place, host, git);
  const row = useRef<HTMLElement>(null);
  const full = branchText(git);
  const fit = useStatusFit(row, full, host.label);

  return (
    <footer
      ref={row}
      data-testid="editor-status-bar"
      className="text-caption text-text-subtle flex h-full min-w-0 flex-1 items-center gap-4 overflow-hidden px-3.5 tabular-nums"
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap",
          away && "opacity-(--opacity-dimmed)"
        )}
      >
        <span className="bg-text-subtle size-1.5 shrink-0 rounded-full" />
        <span
          data-fit={FIT_HOST}
          data-testid="status-host"
          className="truncate"
          style={fit.host === null ? undefined : { maxWidth: fit.host }}
          title={fit.host === null ? undefined : host.label}
        >
          {host.label}
        </span>
        {note === null ? null : away ? (
          <span className="ml-1">{note}</span>
        ) : (
          // Only the latency drops for room; Settings → Hosts still shows it.
          <span className="ml-1" data-drop="latency" hidden={fit.drops.includes("latency")}>
            {note}
          </span>
        )}
      </span>
      {git === null || git === "none" ? null : (
        <GitItems
          git={git}
          sync={sync}
          drops={fit.drops}
          away={away}
          branch={full === null ? null : { full, shown: fit.branch ?? full }}
        />
      )}
      <span data-fit={FIT_SPACER} className="min-w-0 flex-1" />
      <CompletionsFit value={fit.completions}>
        <StatusDrops value={fit.drops}>{right}</StatusDrops>
      </CompletionsFit>
    </footer>
  );
};
