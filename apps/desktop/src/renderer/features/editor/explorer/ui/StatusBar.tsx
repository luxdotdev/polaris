/**
 * The Editor's status bar (DESIGN.md, Editor → Status bar): 26px, caption, on
 * surface-sunken. Left: the Host (latency when remote), branch and change
 * count; right: the editor's own part (position, language, vim mode).
 */
import { BranchIcon, cn } from "@polaris/ui";
import type { ReactNode } from "react";
import type { HostView } from "../../../../../shared/api.ts";
import type { GitFacts } from "../data/store.ts";

export interface StatusBarProps {
  readonly host: HostView;
  readonly git: GitFacts | "none" | null;
  readonly right: ReactNode;
}

const hostNote = (host: HostView): string | null => {
  const { state, latencyMs } = host.status;

  if (state === "reconnecting" || state === "offline") return state;

  return host.alias !== null && latencyMs !== null ? `${Math.round(latencyMs)} ms` : null;
};

export const StatusBar = ({ host, git, right }: StatusBarProps) => {
  const note = hostNote(host);
  const away = host.status.state !== "connected";

  return (
    <footer
      data-testid="editor-status-bar"
      className="border-hairline bg-surface-sunken text-caption text-text-subtle flex h-[26px] shrink-0 items-center gap-4 border-t px-3 tabular-nums"
    >
      <span className={cn("flex items-center gap-1.5", away && "opacity-(--opacity-dimmed)")}>
        <span className="bg-text-subtle size-1.5 rounded-full" />
        {host.label}
        {note === null ? null : <span>· {note}</span>}
      </span>
      {git === null || git === "none" ? null : (
        <>
          {git.branch === null ? null : (
            <span className="flex min-w-0 items-center gap-1.5" data-testid="status-branch">
              <BranchIcon size={12} className="shrink-0" />
              <span className="truncate">{git.branch}</span>
              {git.ahead > 0 ? <span>↑{git.ahead}</span> : null}
            </span>
          )}
          <span data-testid="status-changed">
            {git.marks.changed > 0 ? `${git.marks.changed} changed` : "No changes"}
          </span>
        </>
      )}
      <span className="flex-1" />
      {right}
    </footer>
  );
};
