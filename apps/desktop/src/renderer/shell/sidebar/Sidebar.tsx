/**
 * The Input column (264px): the selected Workspace's Agent Sessions in the
 * Workspace bar, or the selected machine's sessions grouped by Workspace in
 * the machine bar; the Sessions / Needs you switch; "Needs you elsewhere".
 */
import type { Workspace } from "@polaris/protocol";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  IconButton,
  Kbd,
  PlusIcon,
  SectionHeader,
  SegmentedControl,
} from "@polaris/ui";
import { useMemo } from "react";
import { slots } from "../../app/slots.tsx";
import { type SidebarView, sessionOrder, workspaceKey } from "../../routes/selection.ts";
import { activeSessions, needsYou, shownState, shownWorkspaces } from "../../routes/topBar.ts";
import { emptyHostModel, type HostModel, type SessionEntry } from "../../store/hostModel.ts";
import type { HostView } from "../../../shared/api.ts";
import { age, homePath, plural } from "../copy.ts";
import { HostStateNote } from "../HostState.tsx";
import { useApp, useNav, useSelection, useShellActions } from "../hooks.ts";
import { useNow } from "../useNow.ts";
import { Elsewhere } from "./Elsewhere.tsx";
import { CompactSessionRow, SessionRow, WorktreeRows } from "./SessionRow.tsx";

const useHostModel = (hostKey: string | null) =>
  useApp((s) => (hostKey === null ? undefined : s.hostModels[hostKey])) ?? emptyHostModel;

const useWaiting = () =>
  useApp((s) => {
    let n = 0;

    for (const model of Object.values(s.hostModels)) {
      for (const entry of model.sessions.values()) if (needsYou(entry)) n++;
    }

    return n;
  });

const ViewSwitch = () => {
  const { sidebar } = useSelection();
  const { showSidebar } = useShellActions();
  const waiting = useWaiting();

  return (
    <SegmentedControl<SidebarView>
      aria-label="Sidebar view"
      variant="fill"
      value={sidebar}
      onValueChange={showSidebar}
      options={[
        { value: "sessions", label: "Sessions" },
        {
          value: "needs-you",
          label: "Needs you",
          badge:
            waiting > 0 ? <span className="text-micro text-needs-you">{waiting}</span> : undefined,
        },
      ]}
    />
  );
};

interface HeaderProps {
  readonly title: string;
  readonly caption: string;
  readonly canStart: boolean;
  readonly host?: HostView;
}

const Header = ({ title, caption, canStart, host }: HeaderProps) => {
  const { startNewSession } = useShellActions();

  return (
    <div className="px-panel pt-panel flex flex-col gap-3 pb-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading text-text-strong truncate">{title}</h1>
          <p className="text-caption text-text-faint truncate">{caption}</p>
        </div>
        {canStart ? (
          <IconButton
            label="New session"
            icon={<PlusIcon />}
            shortcut="⌘N"
            onClick={startNewSession}
          />
        ) : null}
      </div>
      {host === undefined ? null : <HostStateNote host={host} />}
      <ViewSwitch />
    </div>
  );
};

const worktreesBy = (model: HostModel, entry: SessionEntry) =>
  [...model.worktrees.values()].filter((w) => w.createdBySessionId === entry.session.id);

interface WorkspaceListProps {
  readonly hostKey: string;
  readonly model: HostModel;
  readonly workspace: Workspace;
}

const WorkspaceSessions = ({ hostKey, model, workspace }: WorkspaceListProps) => {
  const now = useNow();

  const entries = useMemo(
    () => [...activeSessions(model, workspace.id)].sort(sessionOrder),
    [model, workspace.id]
  );

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2">
      <SectionHeader empty={entries.length === 0 ? `None in ${workspace.name}` : undefined}>
        Sessions
      </SectionHeader>
      {entries.map((entry) => (
        <div key={entry.session.id} className="flex flex-col">
          <SessionRow hostKey={hostKey} entry={entry} now={now} />
          <WorktreeRows worktrees={worktreesBy(model, entry)} />
        </div>
      ))}
    </div>
  );
};

/** Machine groups show this many sessions, loudest first, then "N more". */
const GROUP_CAP = 3;

const hiddenSummary = (rest: ReadonlyArray<SessionEntry>) => {
  const states = [...new Set(rest.map((e) => shownState(e)))].map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ")
  );

  return `${rest.length} more, ${states.join(", ")}`;
};

const MachineGroup = ({
  hostKey,
  model,
  workspace,
  now,
}: WorkspaceListProps & { readonly now: number }) => {
  const { toggleFolded } = useShellActions();
  const key = workspaceKey(hostKey, workspace.id);
  const folded = useNav((s) => s.folded[key]);
  const { sessionId } = useSelection();

  const entries = useMemo(
    () => [...activeSessions(model, workspace.id)].sort(sessionOrder),
    [model, workspace.id]
  );

  const lively = entries.some(
    (e) => e.session.id === sessionId || !["idle", "dormant"].includes(shownState(e))
  );

  const open = folded === undefined ? lively : !folded;
  const shown = entries.slice(0, GROUP_CAP);
  const rest = entries.slice(GROUP_CAP);

  return (
    <div className="flex flex-col px-2 pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleFolded(key, !open)}
        className="h-tree-row text-caption flex cursor-default items-center gap-1.5 px-2"
      >
        {open ? (
          <ChevronDownIcon size={10} className="text-text-faint" />
        ) : (
          <ChevronRightIcon size={10} className="text-text-faint" />
        )}
        <span
          className="text-text-subtle flex-1 truncate text-left font-medium"
          title={workspace.path}
        >
          {workspace.name}
        </span>
        <span className="text-text-faint tabular">{entries.length}</span>
      </button>
      {open
        ? shown.map((entry) => (
            <CompactSessionRow
              key={entry.session.id}
              hostKey={hostKey}
              entry={entry}
              now={now}
              meta={age(entry.session.createdAt, now)}
            />
          ))
        : null}
      {open && rest.length > 0 ? (
        <p className="text-caption text-text-faint pt-1 pr-2 pl-[34px]">{hiddenSummary(rest)}</p>
      ) : null}
    </div>
  );
};

const Footer = ({ caption }: { readonly caption: string }) => {
  const { openJump } = useShellActions();

  return (
    <div className="border-hairline px-panel flex h-10 shrink-0 items-center gap-2 border-t">
      <button type="button" onClick={openJump} className="flex cursor-default items-center gap-2">
        <Kbd>K</Kbd>
        <span className="text-caption text-text-subtle">Jump</span>
      </button>
      <span className="flex-1" />
      <span className="text-caption text-text-faint truncate">{caption}</span>
    </div>
  );
};

const WorkspaceSidebar = () => {
  const { hostKey, workspaceId, sidebar } = useSelection();
  const model = useHostModel(hostKey);
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const shown = useApp((s) => s.hosts.find((h) => h.key === hostKey || h.alias === null));
  const hostCount = useApp((s) => s.hosts.length);
  const workspace = workspaceId === null ? undefined : model.workspaces.get(workspaceId);

  if (hostKey === null || workspace === undefined || host === undefined) {
    return (
      <SidebarFrame
        header={
          <Header
            title="No workspace yet"
            caption={
              shown === undefined ? "No machines yet" : `${shown.label} · ${shown.status.state}`
            }
            canStart={false}
          />
        }
        footer={hostCount === 0 ? "" : `${plural(hostCount, "host")} · no workspaces`}
      >
        <div className="flex flex-col px-2 pt-2">
          <SectionHeader empty="None yet">Sessions</SectionHeader>
        </div>
      </SidebarFrame>
    );
  }

  const sessions = activeSessions(model, workspace.id);

  const worktrees = [...model.worktrees.values()].filter(
    (w) => w.workspaceId === workspace.id && !w.isMain
  );

  return (
    <SidebarFrame
      header={
        <Header
          title={workspace.name}
          caption={`${host.label} · ${homePath(workspace.path, host.status.host?.homeDir ?? null)}`}
          canStart
          host={host}
        />
      }
      footer={`${plural(sessions.length, "session")} · ${plural(worktrees.length, "worktree")}`}
    >
      {sidebar === "needs-you" ? (
        <slots.NeedsYouInbox />
      ) : (
        <>
          <WorkspaceSessions hostKey={hostKey} model={model} workspace={workspace} />
          <Elsewhere hostKey={hostKey} workspaceId={workspace.id} />
        </>
      )}
    </SidebarFrame>
  );
};

const MachineSidebar = () => {
  const { hostKey, sidebar } = useSelection();
  const model = useHostModel(hostKey);
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const workspaces = shownWorkspaces(model);
  const now = useNow();

  if (hostKey === null || host === undefined) {
    return (
      <SidebarFrame
        header={<Header title="Polaris" caption="No machines yet" canStart={false} />}
        footer=""
      />
    );
  }

  const sessions = activeSessions(model).length;

  return (
    <SidebarFrame
      header={
        <Header
          title={host.label}
          caption={plural(sessions, "session")}
          canStart={workspaces.length > 0}
          host={host}
        />
      }
      footer={`${plural(workspaces.length, "workspace")} · ${plural(sessions, "session")}`}
    >
      {sidebar === "needs-you" ? (
        <slots.NeedsYouInbox />
      ) : (
        <>
          {workspaces.map((workspace) => (
            <MachineGroup
              key={workspace.id}
              hostKey={hostKey}
              model={model}
              workspace={workspace}
              now={now}
            />
          ))}
          <Elsewhere hostKey={hostKey} workspaceId={null} />
        </>
      )}
    </SidebarFrame>
  );
};

interface FrameProps {
  readonly header: React.ReactNode;
  readonly footer: string;
  readonly children?: React.ReactNode;
}

const SidebarFrame = ({ header, footer, children }: FrameProps) => (
  <aside
    aria-label="Sessions"
    className="border-hairline bg-surface-sunken flex w-[264px] shrink-0 flex-col border-r"
  >
    {header}
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">{children}</div>
    <Footer caption={footer} />
  </aside>
);

export const Sidebar = () => {
  const { topBar } = useSelection();

  return topBar === "workspaces" ? <WorkspaceSidebar /> : <MachineSidebar />;
};
