/**
 * The drawers of every Workspace, in one store. Terminal ids persist in
 * `localStorage`: the Daemon keeps its terminals across app restarts, so the
 * drawer re-attaches to the same shells, scrollback replayed.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { type Drawer, emptyDrawer, patchTab, persisted, type TabStatus } from "./model/tabs.ts";

type Drawers = Readonly<Record<string, Drawer>>;

const STORAGE_KEY = "polaris.terminals.v1";

const Persisted = Schema.Record(
  Schema.String,
  Schema.Struct({
    open: Schema.Boolean,
    height: Schema.Number,
    active: Schema.NullOr(Schema.String),
    tabs: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        title: Schema.String,
        cwd: Schema.String,
        argv: Schema.NullOr(Schema.Array(Schema.String)),
        sessionId: Schema.NullOr(Schema.String),
        terminalId: Schema.NullOr(Schema.String),
        status: Schema.Struct({ kind: Schema.Literal("live") }),
      })
    ),
  })
);

const decodePersisted = Schema.decodeUnknownOption(Schema.fromJsonString(Persisted));

export const drawerKey = (hostKey: string, workspaceId: string) => `${hostKey}\u0000${workspaceId}`;

const storage = (): Storage | null =>
  "localStorage" in globalThis ? globalThis.localStorage : null;

const load = (): Drawers => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY) ?? null;

    return raw === null ? {} : Option.getOrElse(decodePersisted(raw), () => ({}));
  } catch {
    return {};
  }
};

export const drawers = createStore<Drawers>(load);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

drawers.subscribe((state) => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const kept = Object.fromEntries(Object.entries(state).map(([k, d]) => [k, persisted(d)]));

    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch {
      // Storage full or unavailable: the drawer still works, it just won't reattach next launch.
    }
  }, 300);
});

export const getDrawer = (key: string): Drawer => drawers.getState()[key] ?? emptyDrawer;

export const updateDrawer = (key: string, update: (drawer: Drawer) => Drawer) =>
  drawers.setState((s) => ({ ...s, [key]: update(s[key] ?? emptyDrawer) }));

export const useDrawer = (key: string | null): Drawer =>
  useStore(drawers, (s) => (key === null ? emptyDrawer : (s[key] ?? emptyDrawer)));

/** A terminal exited or ended: every tab showing it says so. */
type StatusListener = (status: TabStatus) => void;

const statusListeners = new Map<string, Set<StatusListener>>();

/** Hears one terminal's exits and ends, for terminals shown outside the drawer. */
export const onTerminalStatus = (terminalId: string, listener: StatusListener) => {
  const set = statusListeners.get(terminalId) ?? new Set();

  set.add(listener);
  statusListeners.set(terminalId, set);

  return () => {
    set.delete(listener);

    if (set.size === 0) statusListeners.delete(terminalId);
  };
};

export const applyStatus = (terminalId: string, status: TabStatus) => {
  for (const listener of statusListeners.get(terminalId) ?? []) listener(status);

  drawers.setState((all) => {
    const next: Record<string, Drawer> = {};

    for (const [key, drawer] of Object.entries(all)) {
      const tab = drawer.tabs.find((t) => t.terminalId === terminalId);

      next[key] = tab === undefined ? drawer : patchTab(drawer, tab.key, { status });
    }

    return next;
  });
};
