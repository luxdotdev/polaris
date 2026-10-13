/**
 * Hiding a Workspace from the top bar, and showing it again (docs/adr/0037). Hiding deletes
 * nothing: it sets the Workspace's `hidden` flag on its Host, which every Client shares.
 * The right-click menus, the Command Palette and the toast's Undo all go through here.
 */
import type { Command, Workspace } from "@polaris/protocol";
import { PixelFolderIcon, showToast, type ShowToastOptions } from "@polaris/ui";
import { createElement } from "react";
import { Commands } from "../commands.ts";
import type { ContributedCommand, FollowUp, FollowUpChoice } from "../routes/commands.ts";
import type { Navigation, WorkspaceTarget } from "../routes/navigation.ts";
import {
  type BarHost,
  barHosts,
  barWorkspaces,
  hiddenWorkspaces,
  isRegistered,
  shownWorkspaces,
  type TopBarMode,
} from "../routes/topBar.ts";
import type { AppState } from "../store/store.ts";

/** Where Workspaces are listed: chips in the top bar, or groups in the machine sidebar. */
export const workspaceList = (topBar: TopBarMode): string =>
  topBar === "workspaces" ? "top bar" : "sidebar";

export const hideLabel = (topBar: TopBarMode) => `Hide from ${workspaceList(topBar)}`;

export const showLabel = (topBar: TopBarMode) => `Show in ${workspaceList(topBar)}`;

export const hideCommand = (target: WorkspaceTarget, hidden: boolean): Command =>
  Commands.SetWorkspaceHidden({ workspaceId: target.workspaceId, hidden });

/** What to open when `target`, the open Workspace, is hidden: the next chip, else the one before. */
export const afterHiding = (
  bar: ReadonlyArray<BarHost>,
  target: WorkspaceTarget
): WorkspaceTarget | null => {
  const chips = barWorkspaces(bar);

  const at = chips.findIndex(
    (w) => w.hostKey === target.hostKey && w.workspace.id === target.workspaceId
  );

  const next = at === -1 ? undefined : (chips[at + 1] ?? chips[at - 1]);

  return next === undefined ? null : { hostKey: next.hostKey, workspaceId: next.workspace.id };
};

export interface VisibilityInput {
  readonly app: () => AppState;
  readonly navigation: Navigation;
  /** Dispatches `command` to the Host and toasts a refusal under `title`; true when accepted. */
  readonly send: (hostKey: string, command: Command, title: string) => Promise<boolean>;
  readonly notify?: (toast: ShowToastOptions) => void;
}

export interface Visibility {
  readonly hide: (target: WorkspaceTarget) => Promise<boolean>;
  readonly show: (target: WorkspaceTarget) => Promise<boolean>;
}

const workspaceOf = (app: AppState, target: WorkspaceTarget): Workspace | undefined =>
  app.hostModels[target.hostKey]?.workspaces.get(target.workspaceId);

const hostLabel = (app: AppState, hostKey: string) =>
  app.hosts.find((h) => h.key === hostKey)?.label ?? hostKey;

export const createVisibility = ({
  app,
  navigation,
  send,
  notify = showToast,
}: VisibilityInput): Visibility => {
  const { actions } = navigation;

  const isOpen = (target: WorkspaceTarget) => {
    const { hostKey, workspaceId } = navigation.current();

    return hostKey === target.hostKey && workspaceId === target.workspaceId;
  };

  // The open Workspace hands the view to its neighbour first, so nothing jumps after the event.
  const leave = (target: WorkspaceTarget) => {
    const state = app();
    const next = afterHiding(barHosts({ hosts: state.hosts, models: state.hostModels }), target);

    if (next === null) actions.selectHost(target.hostKey);
    else actions.selectWorkspace(next);
  };

  const show = (target: WorkspaceTarget) =>
    send(target.hostKey, hideCommand(target, false), "Couldn't show the workspace");

  const hide = async (target: WorkspaceTarget) => {
    const state = app();
    const workspace = workspaceOf(state, target);

    if (workspace === undefined || workspace.hidden) return false;
    const wasOpen = isOpen(target);

    if (wasOpen) leave(target);
    const ok = await send(target.hostKey, hideCommand(target, true), "Couldn't hide the workspace");

    if (!ok) return false;

    notify({
      source: "starlight",
      icon: createElement(PixelFolderIcon, { size: 16 }),
      title: `Hid ${workspace.name}`,
      message: `Nothing was deleted; its sessions keep going. Right-click ${hostLabel(state, target.hostKey)} to show it again.`,
      action: {
        label: "Undo",
        onAction: () => {
          void show(target);

          if (wasOpen) actions.selectWorkspace(target);
        },
      },
    });

    return true;
  };

  return { hide, show };
};

interface Listed {
  readonly hostKey: string;
  readonly workspace: Workspace;
}

const everyHost = (
  app: AppState,
  pick: (state: AppState, hostKey: string) => ReadonlyArray<Workspace>
) =>
  barHosts({ hosts: app.hosts, models: {} }).flatMap(({ host }): ReadonlyArray<Listed> =>
    pick(app, host.key).map((workspace) => ({ hostKey: host.key, workspace }))
  );

const shownOn = (app: AppState, hostKey: string) => {
  const model = app.hostModels[hostKey];

  return model === undefined ? [] : shownWorkspaces(model);
};

const hiddenOn = (app: AppState, hostKey: string) => {
  const model = app.hostModels[hostKey];

  return model === undefined ? [] : hiddenWorkspaces(model);
};

/** Every hidden Workspace across the Hosts, in bar order. */
export const allHidden = (app: AppState): ReadonlyArray<Listed> => everyHost(app, hiddenOn);

const choice =
  (app: AppState, act: (target: WorkspaceTarget) => void) =>
  ({ hostKey, workspace }: Listed): FollowUpChoice => ({
    id: `${hostKey}\u0000${workspace.id}`,
    title: workspace.name,
    detail:
      app.hosts.length > 1 ? `${hostLabel(app, hostKey)} · ${workspace.path}` : workspace.path,
    run: () => act({ hostKey, workspaceId: workspace.id }),
  });

export const hideFollowUp = (
  app: AppState,
  topBar: TopBarMode,
  hide: (target: WorkspaceTarget) => void
): FollowUp => ({
  title: `Hide which workspace from the ${workspaceList(topBar)}?`,
  note: "Its sessions, worktrees and terminals stay. Show it again any time.",
  choices: everyHost(app, shownOn).map(choice(app, hide)),
});

export const showFollowUp = (
  app: AppState,
  topBar: TopBarMode,
  show: (target: WorkspaceTarget) => void
): FollowUp => ({
  title: `Show which workspace in the ${workspaceList(topBar)}?`,
  choices: allHidden(app).map(choice(app, show)),
});

export interface WorkspaceCommandsInput extends VisibilityInput {
  readonly visibility?: Visibility;
}

/** The palette's commands (contributed: no shortcut or menu). */
export const workspaceCommands = (
  input: WorkspaceCommandsInput
): ReadonlyArray<ContributedCommand> => {
  const { app, navigation } = input;
  const visibility = input.visibility ?? createVisibility(input);

  const open = (): WorkspaceTarget | null => {
    const { hostKey, workspaceId } = navigation.current();

    return hostKey === null ||
      workspaceId === null ||
      !isRegistered(app().hostModels, hostKey, workspaceId)
      ? null
      : { hostKey, workspaceId };
  };

  const openHidden = () => {
    const target = open();

    return target === null ? null : (workspaceOf(app(), target)?.hidden ?? null);
  };

  const topBar = () => navigation.current().topBar;
  const keywords = ["remove", "close", "declutter", "hidden"];

  return [
    {
      id: "workspace.hide",
      title: "Hide {workspace} from the {workspaceList}",
      palette: { group: "workspace", keywords },
      when: "workspace",
      handler: {
        run: () => {
          const target = open();

          if (target !== null) void visibility.hide(target);
        },
        enabled: () => openHidden() === false,
      },
    },
    {
      id: "workspace.show",
      title: "Show {workspace} in the {workspaceList}",
      palette: { group: "workspace", keywords: ["unhide", "restore", "hidden"] },
      when: "workspace",
      handler: {
        run: () => {
          const target = open();

          if (target !== null) void visibility.show(target);
        },
        enabled: () => openHidden() === true,
      },
    },
    {
      id: "workspace.hideOther",
      title: "Hide a workspace from the {workspaceList}…",
      palette: { group: "app", keywords, followUp: true },
      handler: {
        followUp: () => hideFollowUp(app(), topBar(), (t) => void visibility.hide(t)),
        enabled: () => everyHost(app(), shownOn).length > 0,
      },
    },
    {
      id: "workspace.showHidden",
      title: "Show hidden workspaces…",
      palette: {
        group: "app",
        keywords: ["unhide", "restore", "hidden", "workspace"],
        followUp: true,
      },
      handler: {
        followUp: () => showFollowUp(app(), topBar(), (t) => void visibility.show(t)),
        enabled: () => allHidden(app()).length > 0,
      },
    },
  ];
};
