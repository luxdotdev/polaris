/**
 * The explorer (Paper E1, DESIGN.md Editor): 264px on surface-sunken. The
 * Workspace header, Files / Changes, the tree, "Agents in {workspace}", and the
 * jump hint with the Workspace's counts.
 */
import type { Workspace } from "@polaris/protocol";
import {
  ChevronLeftIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  PlusIcon,
  SegmentedControl,
} from "@polaris/ui";
import { useEffect } from "react";
import type { HostView } from "../../../../../shared/api.ts";
import { homePath, plural } from "../../../../shell/copy.ts";
import { useApp, useShellActions } from "../../../../shell/hooks.ts";
import { activeSessions } from "../../../../routes/topBar.ts";
import { type Place, startDraft } from "../data/actions.ts";
import { type ExplorerView, patchExplorer } from "../data/store.ts";
import { useExplorer } from "../data/useExplorer.ts";
import { openFile, setAgentFiles, useEditorTabs } from "../editorSeam.tsx";
import { basename } from "../model/paths.ts";
import { AgentsIn } from "./AgentsIn.tsx";
import { ChangesList } from "./ChangesList.tsx";
import { Tree } from "./Tree.tsx";

export interface ExplorerProps {
  readonly host: HostView;
  readonly workspace: Workspace;
}

const canManage = (host: HostView) =>
  host.status.state === "connected" && host.status.capabilities.includes("files.manage");

interface HeaderProps {
  readonly host: HostView;
  readonly workspace: Workspace;
  readonly place: Place;
  readonly override: boolean;
}

const Header = ({ host, workspace, place, override }: HeaderProps) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <div className="flex items-start justify-between gap-2">
      <h1 className="text-heading text-text-strong min-w-0 truncate" title={workspace.name}>
        {workspace.name}
      </h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="New file or folder"
            size="sm"
            disabled={!canManage(host)}
            icon={<PlusIcon size={16} />}
            className="text-text-subtle -mt-1 -mr-1.5"
            data-testid="explorer-new"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              startDraft(place.key, { kind: "create", dir: place.root, entry: "file" })
            }
          >
            New file
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              startDraft(place.key, { kind: "create", dir: place.root, entry: "directory" })
            }
          >
            New folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <p
      className="text-caption text-text-subtle truncate"
      title={place.root}
      data-testid="explorer-where"
    >
      {host.label} · {homePath(place.root, host.status.host?.homeDir ?? null)}
    </p>
    {override ? (
      <button
        type="button"
        data-testid="explorer-back"
        onClick={() => patchExplorer(place.key, () => ({ root: null }))}
        className="text-caption text-text-subtle hover:text-text-default flex cursor-default items-center gap-1 self-start"
      >
        <ChevronLeftIcon size={12} />
        Back to {basename(workspace.path)}
      </button>
    ) : null}
  </div>
);

const Footer = ({ host, workspace }: ExplorerProps) => {
  const { openJump } = useShellActions();
  const model = useApp((s) => s.hostModels[host.key]);
  const sessions = model === undefined ? 0 : activeSessions(model, workspace.id).length;

  const worktrees =
    model === undefined
      ? 0
      : [...model.worktrees.values()].filter((w) => w.workspaceId === workspace.id && !w.isMain)
          .length;

  const counts = [
    sessions > 0 ? plural(sessions, "agent") : null,
    worktrees > 0 ? plural(worktrees, "worktree") : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <div className="border-hairline px-panel flex h-10 shrink-0 items-center gap-2 border-t">
      <button type="button" onClick={openJump} className="flex cursor-default items-center gap-2">
        <Kbd>K</Kbd>
        <span className="text-caption text-text-subtle">Jump</span>
      </button>
      <span className="flex-1" />
      <span className="text-caption text-text-subtle min-w-0 truncate">{counts}</span>
    </div>
  );
};

const gitState = (git: ReturnType<typeof useExplorer>["state"]["git"]) => {
  if (git === null) return "loading";

  return git === "none" ? "none" : "ready";
};

export const Explorer = ({ host, workspace }: ExplorerProps) => {
  const data = useExplorer(host.key, workspace.id, workspace.path);
  const tabs = useEditorTabs(host.key, workspace.id);

  const place: Place = {
    key: data.key,
    hostKey: host.key,
    workspaceId: workspace.id,
    root: data.root,
  };

  const changed = data.changes.length;

  useEffect(
    () => setAgentFiles(host.key, workspace.id, data.agents.editing),
    [host.key, workspace.id, data.agents]
  );

  const open = (path: string, pin: boolean) =>
    openFile({ hostKey: host.key, workspaceId: workspace.id, path, preview: !pin });

  return (
    <aside
      aria-label="Explorer"
      data-testid="explorer"
      className="border-hairline bg-surface-sunken flex w-[264px] shrink-0 flex-col border-r"
    >
      <div className="px-panel flex flex-col gap-3 pt-4 pb-3">
        <Header
          host={host}
          workspace={workspace}
          place={place}
          override={data.state.root !== null}
        />
        <SegmentedControl<ExplorerView>
          aria-label="Files or changes"
          variant="fill"
          value={data.state.view}
          onValueChange={(view) => patchExplorer(data.key, () => ({ view }))}
          options={[
            { value: "files", label: "Files" },
            {
              value: "changes",
              label: "Changes",
              badge:
                changed === 0 ? undefined : (
                  <span className="text-micro text-text-subtle font-normal tabular-nums">
                    {changed}
                  </span>
                ),
            },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {data.state.view === "files" ? (
          <Tree
            place={place}
            rows={data.rows}
            draft={data.state.draft}
            focused={data.state.focused}
            tabs={tabs}
            hostLabel={host.label}
            canManage={canManage(host)}
            onOpen={open}
          />
        ) : (
          <ChangesList
            rows={data.changes}
            active={tabs.active}
            git={gitState(data.state.git)}
            onOpen={open}
          />
        )}
      </div>
      <AgentsIn hostKey={host.key} workspaceId={workspace.id} name={workspace.name} />
      <Footer host={host} workspace={workspace} />
    </aside>
  );
};
