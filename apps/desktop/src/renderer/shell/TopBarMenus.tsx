/**
 * The top bar's right-click menus (Paper M2): a Workspace chip's (New session, Open in
 * Edit, Open terminal here · Copy path, Reveal in Finder) and a Host's.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import type { ComponentProps, ReactElement } from "react";
import type { HostView } from "../../shared/api.ts";
import { polaris } from "../features/bridge.ts";
import { slots } from "../app/slots.tsx";
import { type BarWorkspace, LOCAL_HOST } from "../routes/topBar.ts";
import { useCommands, useShellActions } from "./hooks.ts";
import { copyEntry, menuShortcut, revealInFinderEntry } from "./menu/index.ts";

/** A hover card's trigger around the menu passes its props through to the chip. */
type Slot = Omit<ComponentProps<typeof ContextMenuTrigger>, "asChild" | "children">;

const Menu = ({
  entries,
  testId,
  children,
  ...slot
}: Slot & {
  readonly entries: ReadonlyArray<MenuEntryInput>;
  readonly testId: string;
  readonly children: ReactElement;
}) => (
  <ContextMenu>
    <ContextMenuTrigger asChild {...slot}>
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent data-testid={testId}>
      <ContextMenuEntries entries={entries} />
    </ContextMenuContent>
  </ContextMenu>
);

/** ⌘N and ⌘3 show only on the current Workspace's chip, where they'd act. */
export const WorkspaceChipMenu = ({
  item,
  current,
  children,
  ...slot
}: Slot & {
  readonly item: BarWorkspace;
  readonly current: boolean;
  readonly children: ReactElement;
}) => {
  const commands = useCommands();
  const { selectWorkspace } = useShellActions();
  const { hostKey, workspace } = item;
  const select = () => selectWorkspace({ hostKey, workspaceId: workspace.id });

  const shortcut = (id: Parameters<typeof menuShortcut>[0]) =>
    current ? menuShortcut(id) : undefined;

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: "New session",
      shortcut: shortcut("session.new"),
      onSelect: () => {
        select();
        commands.run("session.new");
      },
    },
    {
      kind: "item",
      label: "Open in Edit",
      shortcut: shortcut("view.edit"),
      onSelect: () => {
        select();
        commands.run("view.edit");
      },
    },
    {
      kind: "item",
      label: "Open terminal here",
      onSelect: () => {
        select();
        slots.openTerminal({ hostKey, workspaceId: workspace.id }, workspace.path, workspace.name);
      },
    },
    MENU_SEPARATOR_ENTRY,
    copyEntry("Copy path", workspace.path),
    revealInFinderEntry(hostKey, workspace.path),
  ];

  return (
    <Menu entries={entries} testId="workspace-context-menu" {...slot}>
      {children}
    </Menu>
  );
};

export const HostMenu = ({
  host,
  children,
  ...slot
}: Slot & {
  readonly host: HostView;
  readonly children: ReactElement;
}) => {
  const { startNewSessionIn, openSettings } = useShellActions();
  const remote = host.key !== LOCAL_HOST;
  const down = host.status.state !== "connected";

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: `New session on ${host.label}…`,
      needsInput: true,
      onSelect: () => startNewSessionIn(host.key),
    },
    remote && {
      kind: "item",
      label: "Open SSH terminal",
      onSelect: () => void polaris().request("machines.openSsh", { hostKey: host.key }),
    },
    MENU_SEPARATOR_ENTRY,
    down && {
      kind: "item",
      label: "Retry now",
      onSelect: () => void polaris().request("host.retryNow", { hostKey: host.key }),
    },
    { kind: "item", label: "Host details", onSelect: () => openSettings("hosts") },
  ];

  return (
    <Menu entries={entries} testId="host-context-menu" {...slot}>
      {children}
    </Menu>
  );
};
