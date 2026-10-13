/**
 * The top bar's right-click menus (Paper M2): a Workspace chip's (New session, Open in
 * Edit, Open terminal here · Copy path, Reveal in Finder · Hide) and a Host's.
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
import { send } from "../features/session/dispatch.ts";
import { slots } from "../app/slots.tsx";
import { type BarWorkspace, hiddenWorkspaces, LOCAL_HOST } from "../routes/topBar.ts";
import {
  useApp,
  useCommands,
  useConnection,
  useNavigation,
  useSelection,
  useShellActions,
} from "./hooks.ts";
import { copyEntry, menuShortcut, revealInFinderEntry } from "./menu/index.ts";
import { createVisibility, hideLabel, showLabel, type Visibility } from "./visibility.ts";

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

/** Hide and show, dispatched to the Workspace's Host. */
export const useVisibility = (): Visibility => {
  const { store } = useConnection();
  const navigation = useNavigation();

  return createVisibility({ app: store.getState, navigation, send });
};

/** ⌘N and ⌘3 show only on the current Workspace's chip, where they'd act. */
export const WorkspaceChipMenu = ({
  item,
  current,
  children,
  ...slot
}: Slot & {
  readonly item: Pick<BarWorkspace, "hostKey" | "workspace">;
  readonly current: boolean;
  readonly children: ReactElement;
}) => {
  const commands = useCommands();
  const { selectWorkspace } = useShellActions();
  const { topBar } = useSelection();
  const visibility = useVisibility();
  const { hostKey, workspace } = item;
  const target = { hostKey, workspaceId: workspace.id };
  const select = () => selectWorkspace(target);

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
        slots.openTerminal(target, workspace.path, workspace.name);
      },
    },
    MENU_SEPARATOR_ENTRY,
    copyEntry("Copy path", workspace.path),
    revealInFinderEntry(hostKey, workspace.path),
    MENU_SEPARATOR_ENTRY,
    workspace.hidden
      ? {
          kind: "item",
          label: showLabel(topBar),
          testId: "workspace-show",
          onSelect: () => void visibility.show(target),
        }
      : {
          kind: "item",
          label: hideLabel(topBar),
          testId: "workspace-hide",
          onSelect: () => void visibility.hide(target),
        },
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
  const { topBar } = useSelection();
  const visibility = useVisibility();
  const model = useApp((s) => s.hostModels[host.key]);
  const hidden = model === undefined ? [] : hiddenWorkspaces(model);
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
    hidden.length > 0 && {
      kind: "sub",
      label: `Hidden workspaces (${hidden.length})`,
      testId: "host-hidden-workspaces",
      entries: [
        { kind: "label", text: showLabel(topBar) },
        ...hidden.map((workspace): MenuEntryInput => ({
          kind: "item",
          label: workspace.name,
          testId: "host-show-workspace",
          onSelect: () => void visibility.show({ hostKey: host.key, workspaceId: workspace.id }),
        })),
      ],
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
