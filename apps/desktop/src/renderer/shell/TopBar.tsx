/**
 * The adaptive top bar (ENG-177): Workspace chips across every Host while
 * there are at most 10 (⌃1…⌃0), the machine bar from 11 (⌃1… per machine),
 * nothing with a single machine in machine mode. A Host's Connection State
 * shows inline, never as a modal.
 */
import { Badge, Chip, cn, Kbd, PlusIcon } from "@polaris/ui";
import { Fragment, useMemo } from "react";
import type { HostView } from "../../shared/api.ts";
import { type BarHost, barHosts, shortcutLabel } from "../routes/topBar.ts";
import {
  acknowledgeUpgrade,
  UpgradeHover,
  useUpgradeCaption,
} from "../features/machines/updates/UpgradeStatus.tsx";
import { slots } from "../app/slots.tsx";
import { plural } from "./copy.ts";
import { HostBarLabel, HostStateCaption } from "./HostState.tsx";
import { isSlowLink } from "./hostCopy.ts";
import { SummaryGlyph } from "./glyphs.tsx";
import { useApp, useCommands, useSelection, useShellActions } from "./hooks.ts";

/** ⌃N, only on the first ten chips (Chip takes no undefined shortcut). */
interface ChipShortcut {
  shortcut?: string;
}

const useBar = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => barHosts({ hosts, models }), [hosts, models]);
};

const connected = (host: HostView) => host.status.state === "connected";

/** The Host's chips show last known state, dimmed, while it isn't connected (rule/remote-is-normal). */
const dimmed = (host: HostView) =>
  host.status.state === "reconnecting" || host.status.state === "offline";

/** Paper 57Q-1: a dashed chip that adds a Workspace (⌘O on this Mac). */
const AddWorkspaceChip = ({ hostKey }: { readonly hostKey: string | null }) => {
  const commands = useCommands();

  if (hostKey === null) return null;

  return (
    <button
      type="button"
      onClick={() => commands.run("workspace.add")}
      data-testid="add-workspace"
      className="hover:bg-fill-hover rounded-control border-text-subtle/30 ml-1 flex h-7 shrink-0 cursor-default items-center gap-1.5 border border-dashed px-2.5"
    >
      <span className="text-label text-text-subtle">+ Add workspace</span>
      <Kbd variant="plain" className="text-text-subtle">
        ⌘O
      </Kbd>
    </button>
  );
};

const HostLabel = ({ group }: { readonly group: BarHost }) => {
  const { host } = group;
  const selection = useSelection();
  const { selectHost, selectWorkspace } = useShellActions();
  const first = group.workspaces[0];

  // Its first Workspace, or the Host itself when it has none (the stage to add one).
  const open = (at?: number) => {
    acknowledgeUpgrade(host.key);

    if (first === undefined) selectHost(host.key, at);
    else selectWorkspace({ hostKey: host.key, workspaceId: first.workspace.id }, at);
  };

  // Needs Attention is its own bordered chip (a button); the others are a label to select the Host.
  if (host.status.state === "needs-attention") {
    return (
      <span className="flex shrink-0" data-host={host.key} data-connection={host.status.state}>
        <HostBarLabel host={host} onOpen={() => open()} />
      </span>
    );
  }

  return (
    <UpgradeHover hostKey={host.key}>
      <button
        type="button"
        aria-pressed={host.key === selection.hostKey && selection.workspaceId === null}
        onClick={(event) => open(event.timeStamp)}
        className="hover:bg-fill-hover rounded-control flex h-7 shrink-0 cursor-default items-center"
        data-host={host.key}
        data-connection={host.status.state}
      >
        <HostBarLabel host={host} onOpen={() => open()} />
      </button>
    </UpgradeHover>
  );
};

const WorkspaceBar = ({ bar }: { readonly bar: ReadonlyArray<BarHost> }) => {
  const selection = useSelection();
  const { selectWorkspace } = useShellActions();
  let index = 0;

  return (
    <nav
      aria-label="Workspaces"
      className="border-hairline bg-surface-sunken flex h-10 shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-3"
    >
      {bar.map((group, groupIndex) => (
        <Fragment key={group.host.key}>
          {groupIndex === 0 ? null : <span className="bg-text-faint/25 mx-1.5 h-4 w-px shrink-0" />}
          <HostLabel group={group} />
          {group.workspaces.map(({ hostKey, workspace, summary }) => {
            const shortcut = shortcutLabel(index++);
            const extra: ChipShortcut = {};

            if (shortcut !== undefined) extra.shortcut = shortcut;

            return (
              <slots.NeedsYouHover key={workspace.id} hostKey={hostKey} workspaceId={workspace.id}>
                <Chip
                  title={workspace.path}
                  className={cn(dimmed(group.host) && "opacity-(--opacity-dimmed)")}
                  selected={hostKey === selection.hostKey && workspace.id === selection.workspaceId}
                  needsYou={summary.needsYou}
                  {...extra}
                  leading={<SummaryGlyph summary={summary} />}
                  onClick={(event) =>
                    selectWorkspace({ hostKey, workspaceId: workspace.id }, event.timeStamp)
                  }
                >
                  {workspace.name}
                </Chip>
              </slots.NeedsYouHover>
            );
          })}
        </Fragment>
      ))}
      <AddWorkspaceChip hostKey={selection.hostKey} />
    </nav>
  );
};

/** "5 workspaces", or the state when that is the news (Paper MX-0: "Slow link"). */
const MachineCaption = ({ group }: { readonly group: BarHost }) => {
  const upgrade = useUpgradeCaption(group.host.key);

  if (!connected(group.host) || isSlowLink(group.host))
    return <HostStateCaption host={group.host} />;

  return (
    <span className="text-caption text-text-subtle">
      {upgrade ?? plural(group.workspaces.length, "workspace")}
    </span>
  );
};

const MachineBar = ({ bar }: { readonly bar: ReadonlyArray<BarHost> }) => {
  const selection = useSelection();
  const { selectHost, openSettings } = useShellActions();

  return (
    <nav
      aria-label="Machines"
      className="h-session-row border-hairline bg-surface-sunken flex shrink-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto border-b px-3"
    >
      {bar.map((group, index) => {
        const selected = group.host.key === selection.hostKey;
        const shortcut = shortcutLabel(index);

        return (
          <UpgradeHover key={group.host.key} hostKey={group.host.key}>
            <button
              type="button"
              aria-pressed={selected}
              data-host={group.host.key}
              data-connection={group.host.status.state}
              onClick={(event) => {
                acknowledgeUpgrade(group.host.key);
                selectHost(group.host.key, event.timeStamp);
              }}
              className={cn(
                "gap-gap px-row-x flex h-[34px] shrink-0 cursor-default items-center rounded-[8px] border border-transparent",
                selected
                  ? "border-hairline bg-surface-raised shadow-[0_1px_2px_#0000000a]"
                  : "hover:bg-fill-hover"
              )}
            >
              <SummaryGlyph summary={group.summary} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn("text-label", selected ? "text-text-strong" : "text-text-default")}
                >
                  {group.host.label}
                </span>
                <MachineCaption group={group} />
              </span>
              {group.summary.needsYou > 0 ? (
                <Badge tone="needs-you" size="count">
                  {group.summary.needsYou}
                </Badge>
              ) : null}
              {shortcut === undefined ? null : <Kbd variant="plain">{shortcut}</Kbd>}
            </button>
          </UpgradeHover>
        );
      })}
      <button
        type="button"
        onClick={() => openSettings("hosts", { adding: true })}
        data-testid="add-machine"
        className="px-row-x hover:bg-fill-hover flex h-[34px] shrink-0 cursor-default items-center gap-1.5 rounded-[8px]"
      >
        <PlusIcon size={14} className="text-text-subtle" />
        <span className="text-label font-regular text-text-subtle">Add machine</span>
      </button>
    </nav>
  );
};

export const TopBar = () => {
  const bar = useBar();
  const { topBar } = useSelection();

  if (topBar === "hidden" || bar.length === 0) return null;

  return topBar === "workspaces" ? <WorkspaceBar bar={bar} /> : <MachineBar bar={bar} />;
};
