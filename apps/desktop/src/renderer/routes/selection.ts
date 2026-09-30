/**
 * What is selected, resolved against the data: the navigation state records
 * the user's choices, which may point at a Workspace or session that has since
 * gone; this picks the nearest thing that exists. Pure, so it is unit-tested.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import type { Route } from "../../shared/api.ts";
import type { HostModel, SessionEntry } from "../store/hostModel.ts";
import {
  activeSessions,
  type BarHost,
  barWorkspaces,
  needsYou,
  type TopBarMode,
} from "./topBar.ts";

export type SidebarView = "sessions" | "needs-you";

export type Pane = "session" | "new-session";

/** The Settings pages (DESIGN.md, Settings); features/machines fills "hosts". */
export type SettingsSection = "appearance" | "harnesses" | "usage" | "hosts";

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  "appearance",
  "harnesses",
  "usage",
  "hosts",
];

/** Settings, open over the three zones; null when closed. */
export interface SettingsRoute {
  readonly section: SettingsSection;
  /** Hosts only: open the add-a-host form at once. */
  readonly adding: boolean;
}

export interface NavState {
  readonly mode: Route;
  readonly hostKey: string | null;
  readonly workspaceId: WorkspaceId | null;
  readonly sessionId: SessionId | null;
  readonly pane: Pane;
  readonly sidebar: SidebarView;
  readonly jumpOpen: boolean;
  /** The keyboard shortcut overlay (⌘/ or ?). */
  readonly helpOpen: boolean;
  readonly settings: SettingsRoute | null;
  readonly topBar: TopBarMode;
  /** Sessions and Workspaces opened lately, newest first (`recentKey`), for the jump menu. */
  readonly recent: ReadonlyArray<string>;
  /** The session last open in each Workspace (`workspaceKey`), restored on switching back. */
  readonly lastSession: Readonly<Record<string, SessionId>>;
  /** Machine-mode Workspace groups the user folded or unfolded (`workspaceKey`). */
  readonly folded: Readonly<Record<string, boolean>>;
}

export const initialNav: NavState = {
  mode: "orchestrate",
  hostKey: null,
  workspaceId: null,
  sessionId: null,
  pane: "session",
  sidebar: "sessions",
  jumpOpen: false,
  helpOpen: false,
  settings: null,
  topBar: "workspaces",
  recent: [],
  lastSession: {},
  folded: {},
};

export const workspaceKey = (hostKey: string, workspaceId: string) =>
  `${hostKey}\u0000${workspaceId}`;

export type RecentKind = "session" | "workspace";

/** One recent item: its kind, Host and id. */
export const recentKey = (kind: RecentKind, hostKey: string, id: string) =>
  `${kind}\u0000${hostKey}\u0000${id}`;

export const RECENT_LIMIT = 8;

/** `key` moved to the front, without duplicates, capped. */
export const withRecent = (recent: ReadonlyArray<string>, key: string) =>
  [key, ...recent.filter((k) => k !== key)].slice(0, RECENT_LIMIT);

export interface Selection {
  readonly mode: Route;
  readonly topBar: TopBarMode;
  readonly hostKey: string | null;
  readonly workspaceId: WorkspaceId | null;
  readonly sessionId: SessionId | null;
  readonly pane: Pane;
  readonly sidebar: SidebarView;
  readonly settings: SettingsRoute | null;
}

/** Sidebar order: Needs You first (rule/needs-you-is-loudest), then newest first; stable while working. */
export const sessionOrder = (a: SessionEntry, b: SessionEntry) =>
  Number(needsYou(b)) - Number(needsYou(a)) ||
  b.session.createdAt.localeCompare(a.session.createdAt);

export interface ResolveInput {
  readonly nav: NavState;
  readonly bar: ReadonlyArray<BarHost>;
  readonly models: Readonly<Record<string, HostModel>>;
}

const pickHost = ({ nav, bar }: ResolveInput): string | null => {
  const known = bar.find((h) => h.host.key === nav.hostKey);

  if (known !== undefined) return known.host.key;

  return (bar.find((h) => h.workspaces.length > 0) ?? bar[0])?.host.key ?? null;
};

const pickWorkspace = (input: ResolveInput, hostKey: string | null): WorkspaceId | null => {
  const { nav, bar } = input;
  const host = bar.find((h) => h.host.key === hostKey);
  const shown = host?.workspaces ?? [];

  if (shown.some((w) => w.workspace.id === nav.workspaceId)) return nav.workspaceId;

  return shown[0]?.workspace.id ?? null;
};

const pickSession = (
  input: ResolveInput,
  hostKey: string,
  workspaceId: WorkspaceId | null
): SessionId | null => {
  const { nav, models } = input;
  const model = models[hostKey];

  if (model === undefined) return null;

  const inScope = (id: SessionId | null | undefined) => {
    const entry = id === null || id === undefined ? undefined : model.sessions.get(id);

    return entry !== undefined &&
      entry.session.state !== "archived" &&
      (workspaceId === null || entry.session.workspaceId === workspaceId)
      ? entry.session.id
      : null;
  };

  const chosen = inScope(nav.sessionId);

  if (chosen !== null || workspaceId === null) return chosen;

  const remembered = inScope(nav.lastSession[workspaceKey(hostKey, workspaceId)]);

  if (remembered !== null) return remembered;

  return [...activeSessions(model, workspaceId)].sort(sessionOrder)[0]?.session.id ?? null;
};

/** A chosen session decides its Workspace, even one selected before its SessionCreated arrived. */
const followSession = ({ nav, models }: ResolveInput): NavState => {
  const entry =
    nav.hostKey === null || nav.sessionId === null
      ? undefined
      : models[nav.hostKey]?.sessions.get(nav.sessionId);

  return entry === undefined ? nav : { ...nav, workspaceId: entry.session.workspaceId };
};

export const resolveSelection = (raw: ResolveInput): Selection => {
  const input = { ...raw, nav: followSession(raw) };
  const { nav, bar } = input;

  // In the Workspace bar a stale Workspace falls back to the first chip, on any Host.
  const stale =
    nav.topBar === "workspaces" &&
    !barWorkspaces(bar).some(
      (w) => w.hostKey === nav.hostKey && w.workspace.id === nav.workspaceId
    );

  const first = stale ? barWorkspaces(bar)[0] : undefined;
  const hostKey = first?.hostKey ?? pickHost(input);
  const workspaceId = first?.workspace.id ?? pickWorkspace(input, hostKey);

  const sessionId =
    hostKey === null || nav.pane === "new-session"
      ? null
      : pickSession(input, hostKey, workspaceId);

  return {
    mode: nav.mode,
    topBar: nav.topBar,
    hostKey,
    workspaceId,
    sessionId,
    pane: nav.pane,
    sidebar: nav.sidebar,
    settings: nav.settings,
  };
};
