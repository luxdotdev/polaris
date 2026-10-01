/**
 * What the K jump menu can reach, across every Host: Agent Sessions,
 * Workspaces, Worktrees, machines and actions, each with the words it can be
 * found by. Built from the store, so results follow live state.
 */
import type { SessionId, SessionState, WorkspaceId, WorktreeId } from "@polaris/protocol";
import { harnessHue } from "@polaris/ui";
import { formatChord, parseChord } from "../../../shared/chord.ts";
import { bindingOf, type CommandId } from "../../../shared/keymap.ts";
import { recentKey } from "../../routes/selection.ts";
import {
  activeSessions,
  type BarHost,
  barWorkspaces,
  shortcutLabel,
  shownState,
} from "../../routes/topBar.ts";
import { connectionLabel, plural, sessionStateLabel } from "../../shell/copy.ts";
import type { HostModel } from "../../store/hostModel.ts";
import type { Searchable } from "./ranking.ts";

export type JumpTarget =
  | { readonly kind: "session"; readonly hostKey: string; readonly sessionId: SessionId }
  | { readonly kind: "workspace"; readonly hostKey: string; readonly workspaceId: WorkspaceId }
  | {
      readonly kind: "worktree";
      readonly hostKey: string;
      readonly worktreeId: WorktreeId;
      readonly workspaceId: WorkspaceId;
      readonly sessionId: SessionId | null;
    }
  | { readonly kind: "host"; readonly hostKey: string }
  | { readonly kind: "command"; readonly id: CommandId };

export interface JumpItem extends Searchable {
  /** Unique across the menu; also the recent-items key for sessions and Workspaces. */
  readonly id: string;
  readonly target: JumpTarget;
  readonly detail: string;
  readonly meta: string;
  readonly state: SessionState | null;
  readonly harness: string | null;
  readonly needsYou: boolean;
}

const harnessName = (kind: string) => harnessHue(kind).name;

export interface JumpData {
  readonly bar: ReadonlyArray<BarHost>;
  readonly models: Readonly<Record<string, HostModel>>;
  readonly machineBar: boolean;
}

export const sessionItems = ({ bar, models }: JumpData): ReadonlyArray<JumpItem> =>
  bar.flatMap(({ host }) => {
    const model = models[host.key];

    if (model === undefined) return [];

    return activeSessions(model).map((entry): JumpItem => {
      const { session } = entry;
      const state = shownState(entry);
      const workspace = model.workspaces.get(session.workspaceId)?.name ?? "";
      const harness = harnessName(session.harness);

      return {
        id: recentKey("session", host.key, session.id),
        target: { kind: "session", hostKey: host.key, sessionId: session.id },
        title: session.title || "Untitled session",
        keywords: [workspace, host.label, sessionStateLabel[state], harness, session.harness],
        detail: `${host.label} / ${workspace}`,
        meta: `${capitalized(sessionStateLabel[state])} · ${harness}`,
        state,
        harness: session.harness,
        needsYou: state === "needs-you",
      };
    });
  });

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const workspaceItems = ({ bar, machineBar }: JumpData): ReadonlyArray<JumpItem> =>
  barWorkspaces(bar).map((w, index): JumpItem => ({
    id: recentKey("workspace", w.hostKey, w.workspace.id),
    target: { kind: "workspace", hostKey: w.hostKey, workspaceId: w.workspace.id },
    title: w.workspace.name,
    keywords: [bar.find((h) => h.host.key === w.hostKey)?.host.label ?? "", "workspace"],
    detail: `${bar.find((h) => h.host.key === w.hostKey)?.host.label ?? ""} · ${plural(w.summary.sessions, "session")}`,
    meta: machineBar ? "" : (shortcutLabel(index) ?? ""),
    state: w.summary.state,
    harness: w.summary.harness,
    needsYou: w.summary.needsYou > 0,
  }));

export const worktreeItems = ({ bar, models }: JumpData): ReadonlyArray<JumpItem> =>
  bar.flatMap(({ host }) => {
    const model = models[host.key];

    if (model === undefined) return [];

    return [...model.worktrees.values()].flatMap((wt): Array<JumpItem> => {
      if (wt.isMain) return [];
      const workspace = model.workspaces.get(wt.workspaceId)?.name ?? "";
      const branch = wt.branch ?? wt.head.slice(0, 7);

      return [
        {
          id: `worktree\u0000${host.key}\u0000${wt.id}`,
          target: {
            kind: "worktree",
            hostKey: host.key,
            worktreeId: wt.id,
            workspaceId: wt.workspaceId,
            sessionId: wt.createdBySessionId,
          },
          title: branch,
          keywords: [workspace, host.label, "worktree"],
          detail: `${host.label} / ${workspace}`,
          meta: "worktree",
          state: null,
          harness: null,
          needsYou: false,
        },
      ];
    });
  });

export const hostItems = ({ bar, machineBar }: JumpData): ReadonlyArray<JumpItem> =>
  bar.map(({ host, workspaces, summary }, index): JumpItem => ({
    id: `host\u0000${host.key}`,
    target: { kind: "host", hostKey: host.key },
    title: host.label,
    keywords: [host.alias ?? "", "machine", "host", connectionLabel[host.status.state]],
    detail:
      host.status.state === "connected"
        ? plural(workspaces.length, "workspace")
        : connectionLabel[host.status.state],
    meta: machineBar ? (shortcutLabel(index) ?? "") : "",
    state: summary.state,
    harness: summary.harness,
    needsYou: summary.needsYou > 0,
  }));

export interface ActionContext {
  /** The selected Workspace's name, for "New session in polaris". */
  readonly workspace: string | null;
  /** The selected session's title, for "Archive …". */
  readonly session: string | null;
  readonly enabled: (id: CommandId) => boolean;
  /** The theme the toggle leads to. */
  readonly nextTheme: "dark" | "light";
}

const ACTIONS: ReadonlyArray<{
  readonly id: CommandId;
  readonly title: (ctx: ActionContext) => string;
  readonly keywords: ReadonlyArray<string>;
}> = [
  {
    id: "session.new",
    title: (c) => `New session in ${c.workspace ?? "this workspace"}`,
    keywords: ["create", "start", "agent"],
  },
  {
    id: "session.openInTerminal",
    title: (c) => `Open ${c.session ?? "session"} in terminal`,
    keywords: ["tui", "handoff"],
  },
  {
    id: "session.archive",
    title: (c) => `Archive ${c.session ?? "session"}`,
    keywords: ["close", "hide"],
  },
  {
    id: "view.output",
    title: () => "Show or hide output",
    keywords: ["changes", "diff", "panel", "rail"],
  },
  { id: "view.orchestrate", title: () => "Go to Orchestrate", keywords: ["view", "mode"] },
  { id: "view.review", title: () => "Go to Review", keywords: ["view", "mode", "diff"] },
  { id: "view.edit", title: () => "Go to Edit", keywords: ["view", "mode", "editor"] },
  {
    id: "theme.toggle",
    title: (c) => `Switch to ${c.nextTheme} theme`,
    keywords: ["appearance", "dark", "light", "theme"],
  },
  {
    id: "help.shortcuts",
    title: () => "Keyboard shortcuts",
    keywords: ["help", "keys", "hotkeys"],
  },
  { id: "settings.open", title: () => "Settings", keywords: ["preferences", "settings"] },
  {
    id: "settings.appearance",
    title: () => "Settings: Appearance",
    keywords: ["theme", "density", "text size", "font", "motion", "colourblind"],
  },
  {
    id: "settings.sessions",
    title: () => "Settings: Sessions",
    keywords: ["worktree", "branch", "prefix", "output", "notifications", "archive"],
  },
  {
    id: "settings.harnesses",
    title: () => "Settings: Harnesses",
    keywords: ["claude", "codex", "opencode", "sign in", "model", "permissions"],
  },
  {
    id: "settings.usage",
    title: () => "Settings: Usage",
    keywords: ["tokens", "cost", "plan limits", "rate limit"],
  },
  { id: "settings.hosts", title: () => "Settings: Hosts", keywords: ["machines", "ssh"] },
  {
    id: "settings.reviewer",
    title: () => "Settings: Reviewer",
    keywords: ["review", "risk summary", "model", "effort", "codex", "claude"],
  },
  {
    id: "settings.github",
    title: () => "Settings: GitHub accounts",
    keywords: ["github", "account", "owner", "organization", "sign in", "pull requests"],
  },
  {
    id: "github.addAccount",
    title: () => "Add GitHub account…",
    keywords: ["github", "sign in", "device code"],
  },
];

const shortcutOf = (id: CommandId) => {
  const key = bindingOf(id)?.keys[0];

  return key === undefined ? "" : formatChord(parseChord(key));
};

/** The actions that can run now, with their shortcuts. */
export const actionItems = (ctx: ActionContext): ReadonlyArray<JumpItem> =>
  ACTIONS.flatMap((a): Array<JumpItem> =>
    ctx.enabled(a.id)
      ? [
          {
            id: `command\u0000${a.id}`,
            target: { kind: "command", id: a.id },
            title: a.title(ctx),
            keywords: a.keywords,
            detail: "",
            meta: shortcutOf(a.id),
            state: null,
            harness: null,
            needsYou: false,
          },
        ]
      : []
  );
