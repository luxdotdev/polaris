/**
 * The terminal drawer's state, per Workspace: whether it is open, its height,
 * and its tabs (the Workspace's shell, and one per session handed off to its
 * Harness's terminal UI). Pure: `store.ts` holds it, the tests drive it.
 */

/** Where a tab's process stands. `ended` is an exit with no code: a signal or a Daemon restart. */
export type TabStatus =
  | { readonly kind: "opening" }
  | { readonly kind: "live" }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string };

export interface TerminalTab {
  /** "shell", or "handoff:<sessionId>". */
  readonly key: string;
  readonly title: string;
  readonly cwd: string;
  /** Null runs the Host user's login shell. */
  readonly argv: ReadonlyArray<string> | null;
  /** The Agent Session this tab runs the terminal UI of; null for the shell. */
  readonly sessionId: string | null;
  /** Null until `terminal.open` answers. */
  readonly terminalId: string | null;
  readonly status: TabStatus;
}

export interface Drawer {
  readonly open: boolean;
  /** In pixels; clamped by `clampHeight`. */
  readonly height: number;
  readonly active: string | null;
  readonly tabs: ReadonlyArray<TerminalTab>;
}

export const SHELL_TAB = "shell";

export const DEFAULT_HEIGHT = 280;

export const MIN_HEIGHT = 120;

export const emptyDrawer: Drawer = { open: false, height: DEFAULT_HEIGHT, active: null, tabs: [] };

export const handoffKey = (sessionId: string) => `handoff:${sessionId}`;

/** The drawer keeps at least `MIN_HEIGHT` and leaves the pane above at least as much. */
export const clampHeight = (height: number, available: number) =>
  Math.round(Math.max(MIN_HEIGHT, Math.min(height, available - MIN_HEIGHT)));

export const tabOf = (drawer: Drawer, key: string | null) =>
  key === null ? undefined : drawer.tabs.find((t) => t.key === key);

export const activeTab = (drawer: Drawer) => tabOf(drawer, drawer.active) ?? drawer.tabs[0];

/** Adds the tab, or replaces the one with its key (a reopen), and makes it active. */
export const putTab = (drawer: Drawer, tab: TerminalTab): Drawer => {
  const exists = drawer.tabs.some((t) => t.key === tab.key);

  return {
    ...drawer,
    open: true,
    active: tab.key,
    tabs: exists ? drawer.tabs.map((t) => (t.key === tab.key ? tab : t)) : [...drawer.tabs, tab],
  };
};

export const patchTab = (
  drawer: Drawer,
  key: string,
  patch: Partial<Pick<TerminalTab, "terminalId" | "status">>
): Drawer => ({
  ...drawer,
  tabs: drawer.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)),
});

/** Removes the tab; the neighbour to its left (else right) becomes active; the last one closes the drawer. */
export const removeTab = (drawer: Drawer, key: string): Drawer => {
  const index = drawer.tabs.findIndex((t) => t.key === key);

  if (index === -1) return drawer;
  const tabs = drawer.tabs.filter((t) => t.key !== key);
  const neighbour = tabs[Math.max(0, index - 1)]?.key ?? null;

  return {
    ...drawer,
    tabs,
    open: drawer.open && tabs.length > 0,
    active: drawer.active === key ? neighbour : drawer.active,
  };
};

/** A tab still owns a process on the Host that `terminal.close` should end. */
export const holdsProcess = (tab: TerminalTab) =>
  tab.terminalId !== null && (tab.status.kind === "live" || tab.status.kind === "exited");

/** What the drawer remembers across launches: the terminals (the Daemon keeps them), not their status. */
export const persisted = (drawer: Drawer): Drawer => ({
  ...drawer,
  tabs: drawer.tabs.flatMap((t) =>
    t.terminalId === null ? [] : [{ ...t, status: { kind: "live" } as const }]
  ),
});
