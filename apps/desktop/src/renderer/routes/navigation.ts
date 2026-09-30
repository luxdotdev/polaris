/**
 * Navigation: the user's choices (mode, Host, Workspace, session, sidebar
 * view, pane) in a zustand store, persisted per window, plus the actions the
 * shell and features use to move around. `useSelection()` resolves them.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Route } from "../../shared/api.ts";
import type { AppState, AppStore } from "../store/store.ts";
import {
  initialNav,
  type NavState,
  type Selection,
  type SidebarView,
  resolveSelection,
  workspaceKey,
} from "./selection.ts";
import { timeSwitch } from "./switchTimer.ts";
import { barHosts, barWorkspaces, type BarHost, topBarMode } from "./topBar.ts";

export type NavStore = StoreApi<NavState>;

const STORAGE_KEY = "polaris.navigation.v1";

const Persisted = Schema.Struct({
  mode: Schema.Literals(["orchestrate", "review", "edit"]),
  hostKey: Schema.NullOr(Schema.String),
  workspaceId: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  sidebar: Schema.Literals(["sessions", "needs-you"]),
  topBar: Schema.Literals(["workspaces", "machines", "hidden"]),
  lastSession: Schema.Record(Schema.String, Schema.String),
  folded: Schema.Record(Schema.String, Schema.Boolean),
});

const decodePersisted = Schema.decodeUnknownOption(Schema.fromJsonString(Persisted));

/** The persisted navigation, or the defaults; storage can be missing or unreadable. */
export const loadNav = (storage: Pick<Storage, "getItem"> | null): NavState => {
  const raw = (() => {
    try {
      return storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  })();

  if (raw === null) return initialNav;

  return Option.match(decodePersisted(raw), {
    onNone: () => initialNav,
    // SAFETY: ids are opaque branded strings; a stale one resolves to the nearest that exists.
    onSome: (p) => ({ ...initialNav, ...(p as Partial<NavState>) }),
  });
};

const persistable = (nav: NavState) => ({
  mode: nav.mode,
  hostKey: nav.hostKey,
  workspaceId: nav.workspaceId,
  sessionId: nav.sessionId,
  sidebar: nav.sidebar,
  topBar: nav.topBar,
  lastSession: nav.lastSession,
  folded: nav.folded,
});

export interface SessionTarget {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

export interface WorkspaceTarget {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
}

export interface ShellActions {
  readonly setMode: (mode: Route) => void;
  readonly selectSession: (target: SessionTarget) => void;
  /** `inputAt` is the input event's timeStamp, to time the switch. */
  readonly selectWorkspace: (target: WorkspaceTarget, inputAt?: number) => void;
  readonly selectHost: (hostKey: string, inputAt?: number) => void;
  /** ⌃1…⌃0: a Workspace chip in the Workspace bar, a machine in the machine bar. */
  readonly selectShortcut: (index: number, inputAt?: number) => void;
  readonly showSidebar: (view: SidebarView) => void;
  readonly openJump: () => void;
  readonly setJumpOpen: (open: boolean) => void;
  readonly startNewSession: () => void;
  readonly closeNewSession: () => void;
  readonly toggleFolded: (key: string, open: boolean) => void;
}

export interface Navigation {
  readonly store: NavStore;
  readonly actions: ShellActions;
  /** The selection as it stands, resolved against the data. */
  readonly current: () => Selection;
}

const barOf = (app: AppState): ReadonlyArray<BarHost> =>
  barHosts({ hosts: app.hosts, models: app.hostModels });

const sameSelection = (a: Selection, b: Selection) =>
  a.mode === b.mode &&
  a.topBar === b.topBar &&
  a.hostKey === b.hostKey &&
  a.workspaceId === b.workspaceId &&
  a.sessionId === b.sessionId &&
  a.pane === b.pane &&
  a.sidebar === b.sidebar;

export interface NavigationInput {
  readonly app: AppStore;
  readonly storage: Storage | null;
}

export const createNavigation = ({ app, storage }: NavigationInput): Navigation => {
  const store = createStore<NavState>(() => loadNav(storage));
  const set = (patch: Partial<NavState>) => store.setState(patch);

  let cache: { nav: NavState; app: AppState; selection: Selection } | null = null;

  /** Stable between changes, so it can back `useSyncExternalStore`. */
  const current = () => {
    const state = app.getState();
    const nav = store.getState();

    if (
      cache !== null &&
      cache.nav === nav &&
      cache.app.hosts === state.hosts &&
      cache.app.hostModels === state.hostModels
    ) {
      return cache.selection;
    }

    const selection = resolveSelection({ nav, bar: barOf(state), models: state.hostModels });

    const unchanged = cache !== null && sameSelection(cache.selection, selection);

    cache = {
      nav,
      app: state,
      selection: unchanged && cache !== null ? cache.selection : selection,
    };

    return cache.selection;
  };

  /** Remembers the open session of the Workspace being left, so switching back restores it. */
  const remembered = () => {
    const { hostKey, workspaceId, sessionId } = current();
    const { lastSession } = store.getState();

    return hostKey === null || workspaceId === null || sessionId === null
      ? lastSession
      : { ...lastSession, [workspaceKey(hostKey, workspaceId)]: sessionId };
  };

  const selectWorkspace = ({ hostKey, workspaceId }: WorkspaceTarget, inputAt?: number) => {
    set({
      lastSession: remembered(),
      hostKey,
      workspaceId,
      sessionId: null,
      pane: "session",
      mode: "orchestrate",
    });
    timeSwitch(inputAt);
  };

  const selectHost = (hostKey: string, inputAt?: number) => {
    set({
      lastSession: remembered(),
      hostKey,
      workspaceId: null,
      sessionId: null,
      pane: "session",
    });
    timeSwitch(inputAt);
  };

  const actions: ShellActions = {
    setMode: (mode) => set({ mode }),
    selectSession: ({ hostKey, sessionId }) => {
      const entry = app.getState().hostModels[hostKey]?.sessions.get(sessionId);

      set({
        hostKey,
        sessionId,
        workspaceId: entry?.session.workspaceId ?? store.getState().workspaceId,
        pane: "session",
        mode: "orchestrate",
      });
    },
    selectWorkspace,
    selectHost,
    selectShortcut: (index, inputAt) => {
      const bar = barOf(app.getState());

      if (store.getState().topBar === "workspaces") {
        const target = barWorkspaces(bar)[index];

        if (target !== undefined) {
          selectWorkspace({ hostKey: target.hostKey, workspaceId: target.workspace.id }, inputAt);
        }

        return;
      }

      const host = bar[index];

      if (host !== undefined) selectHost(host.host.key, inputAt);
    },
    showSidebar: (sidebar) => set({ sidebar }),
    openJump: () => set({ jumpOpen: true }),
    setJumpOpen: (jumpOpen) => set({ jumpOpen }),
    startNewSession: () => set({ pane: "new-session", mode: "orchestrate" }),
    closeNewSession: () => set({ pane: "session" }),
    toggleFolded: (key, open) => set({ folded: { ...store.getState().folded, [key]: !open } }),
  };

  // The bar's mode follows the Workspace count, with hysteresis (topBar.ts).
  const updateTopBar = (state: AppState) => {
    const bar = barOf(state);
    const previous = store.getState().topBar;

    const next = topBarMode({
      workspaces: barWorkspaces(bar).length,
      hosts: bar.length,
      previous,
    });

    if (next !== previous && state.hosts.length > 0) set({ topBar: next });
  };

  app.subscribe((state, prev) => {
    if (state.hosts !== prev.hosts || state.hostModels !== prev.hostModels) updateTopBar(state);
  });

  let timer: ReturnType<typeof setTimeout> | null = null;

  store.subscribe(() => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;

      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(persistable(store.getState())));
      } catch {
        // Storage can be unavailable; navigation then lasts for this session only.
      }
    }, 300);
  });

  return { store, actions, current };
};
