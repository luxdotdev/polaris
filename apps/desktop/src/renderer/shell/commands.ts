/**
 * The shell's command handlers (ids in `shared/keymap.ts`): views, the jump
 * menu and shortcut help, moving between sessions, and the selected
 * session's actions. Session actions use the session feature's command
 * builders and reach its composer through its test id, without editing it.
 */
import type { SessionId } from "@polaris/protocol";
import { Commands, Decisions } from "../commands.ts";
import { send } from "../features/session/dispatch.ts";
import { toggleOutput } from "../features/session/index.ts";
import { archiveCommand, interruptCommand } from "../features/session/model/intent.ts";
import type { CommandHandlers } from "../routes/commands.ts";
import type { Navigation } from "../routes/navigation.ts";
import { type Selection, sessionOrder } from "../routes/selection.ts";
import { activeSessions, shownWorkspaces } from "../routes/topBar.ts";
import type { SessionEntry } from "../store/hostModel.ts";
import { type AppState, type Connection, sessionKey } from "../store/store.ts";

/** The sessions the sidebar lists, in its order: ⌘⌥↑/↓ walk them. */
export const sidebarSessions = (
  selection: Selection,
  app: AppState
): ReadonlyArray<SessionEntry> => {
  const model = selection.hostKey === null ? undefined : app.hostModels[selection.hostKey];

  if (model === undefined) return [];

  if (selection.topBar === "workspaces") {
    return selection.workspaceId === null
      ? []
      : [...activeSessions(model, selection.workspaceId)].sort(sessionOrder);
  }

  return shownWorkspaces(model).flatMap((w) => [...activeSessions(model, w.id)].sort(sessionOrder));
};

/** The session `step` rows away from the selected one, wrapping around. */
export const stepSession = (
  list: ReadonlyArray<SessionEntry>,
  current: SessionId | null,
  step: number
): SessionEntry | undefined => {
  if (list.length === 0) return undefined;
  const at = list.findIndex((e) => e.session.id === current);

  if (at === -1) return step > 0 ? list[0] : list.at(-1);

  return list[(at + step + list.length) % list.length];
};

export interface ShellCommandsInput {
  readonly connection: Connection;
  readonly navigation: Navigation;
  /** Whether the window is dark right now (the theme toggle flips it). */
  readonly dark: () => boolean;
}

const COMPOSER = '[data-testid="composer-input"]';

export const shellCommands = ({
  connection,
  navigation,
  dark,
}: ShellCommandsInput): CommandHandlers => {
  const { actions } = navigation;
  const app = () => connection.store.getState();

  const selected = () => {
    const { hostKey, sessionId } = navigation.current();

    if (hostKey === null || sessionId === null) return null;
    const entry = app().hostModels[hostKey]?.sessions.get(sessionId);

    return entry === undefined ? null : { hostKey, entry };
  };

  const step = (by: number) => () => {
    const selection = navigation.current();
    const next = stepSession(sidebarSessions(selection, app()), selection.sessionId, by);

    if (next !== undefined && selection.hostKey !== null) {
      actions.selectSession({ hostKey: selection.hostKey, sessionId: next.session.id });
    }
  };

  const lastTurn = (hostKey: string, entry: SessionEntry) =>
    app().sessions[sessionKey(hostKey, entry.session.id)]?.turns.at(-1)?.turn.status ??
    (entry.session.state === "working" ? "working" : null);

  const interrupt = () => {
    const s = selected();

    return s === null ? null : interruptCommand(s.entry.session.id, lastTurn(s.hostKey, s.entry));
  };

  const answer = (approve: boolean) => () => {
    const s = selected();
    const request = s?.entry.pendingApprovals[0];

    if (s === null || request === undefined) return;

    const decision = approve
      ? Decisions.Allow({ remember: false })
      : Decisions.Deny({ reason: null });

    void send(
      s.hostKey,
      Commands.RespondToApproval({
        sessionId: s.entry.session.id,
        requestId: request.id,
        decision,
      }),
      "Couldn't answer"
    );
  };

  const hasApproval = () => (selected()?.entry.pendingApprovals.length ?? 0) > 0;

  return {
    "view.orchestrate": { run: () => actions.setMode("orchestrate") },
    "view.review": { run: () => actions.setMode("review") },
    "view.edit": { run: () => actions.setMode("edit") },
    "view.output": {
      run: () => {
        const s = selected();

        if (s !== null) {
          const { id, workspaceId } = s.entry.session;

          toggleOutput({ hostKey: s.hostKey, workspaceId }, id);
        }
      },
      enabled: () => selected() !== null,
    },
    "jump.open": { run: actions.openJump },
    "help.shortcuts": { run: () => actions.setHelpOpen(true) },
    "session.new": {
      run: actions.startNewSession,
      // With no Workspace, onboarding starts it in the Host's home directory.
      enabled: () => navigation.current().hostKey !== null,
    },
    "session.next": { run: step(1) },
    "session.previous": { run: step(-1) },
    "session.focusComposer": {
      run: () => document.querySelector<HTMLElement>(COMPOSER)?.focus(),
      enabled: () => document.querySelector(COMPOSER) !== null,
    },
    "session.interrupt": {
      run: () => {
        const s = selected();
        const command = interrupt();

        if (s !== null && command !== null) void send(s.hostKey, command, "Couldn't stop");
      },
      enabled: () => interrupt() !== null,
    },
    "approval.approve": { run: answer(true), enabled: hasApproval },
    "approval.deny": { run: answer(false), enabled: hasApproval },
    "session.archive": {
      run: () => {
        const s = selected();

        if (s !== null)
          void send(s.hostKey, archiveCommand(s.entry.session.id), "Couldn't archive");
      },
      enabled: () => selected() !== null,
    },
    "session.openInTerminal": {
      run: () => {
        const s = selected();

        if (s !== null) {
          void send(
            s.hostKey,
            Commands.OpenInTerminal({ sessionId: s.entry.session.id }),
            "Couldn't open in terminal"
          );
        }
      },
      enabled: () => {
        const s = selected();
        const host = s === null ? undefined : app().hosts.find((h) => h.key === s.hostKey);

        return (
          s !== null &&
          s.entry.session.state !== "in-terminal" &&
          (host?.status.capabilities.includes("session.terminal-handoff") ?? false)
        );
      },
    },
    "workspace.add": {
      run: () => {
        const { hostKey } = navigation.current();
        const host = app().hosts.find((h) => h.key === hostKey);

        if (host === undefined) return;

        // This Mac: the native folder picker. Elsewhere: the Host's stage, with a typed path.
        if (host.alias !== null) {
          actions.selectHost(host.key);

          return;
        }

        void window.polaris.request("dialog.pickFolder", {}).then((picked) => {
          if (!picked.ok || picked.value.path === null) return;
          void send(
            host.key,
            Commands.RegisterWorkspace({ path: picked.value.path, name: null }),
            "Couldn't add the workspace"
          );
        });
      },
      enabled: () => navigation.current().hostKey !== null,
    },
    "theme.toggle": {
      run: () =>
        void window.polaris.request("settings.setTheme", { theme: dark() ? "light" : "dark" }),
    },
  };
};
