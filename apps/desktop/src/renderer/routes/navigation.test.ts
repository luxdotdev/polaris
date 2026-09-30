import { describe, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { type AppState, initialState } from "../store/store.ts";
import { hostModel, hostView, workspaces } from "./fixtures.testing.ts";
import { createNavigation, loadNav } from "./navigation.ts";

const memoryStorage = () => {
  const items = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, v),
  };

  return storage;
};

const withData = (counts: Readonly<Record<string, number>>) => {
  const app = createStore<AppState>(() => initialState);

  app.setState({
    hosts: Object.keys(counts).map((k) => hostView(k)),
    hostModels: Object.fromEntries(
      Object.entries(counts).map(([k, n]) => [k, hostModel(workspaces(k, n))])
    ),
  });

  return app;
};

// No animation frames under bun test; the switch timer only needs the function to exist.
globalThis.requestAnimationFrame ??= () => 0;

describe("navigation", () => {
  test("the bar turns into the machine bar at 11 Workspaces, and ⌃N then picks machines", () => {
    const app = createStore<AppState>(() => initialState);
    const nav = createNavigation({ app, storage: null });

    app.setState(withData({ local: 6, studio: 5 }).getState());
    expect(nav.store.getState().topBar).toBe("machines");

    nav.actions.selectShortcut(1);
    expect(nav.current().hostKey).toBe("studio");
  });

  test("⌃N in the Workspace bar picks the Nth chip across Hosts", () => {
    const nav = createNavigation({ app: withData({ local: 2, studio: 2 }), storage: null });

    nav.actions.selectShortcut(2);
    expect([nav.current().hostKey, nav.current().workspaceId]).toEqual(["studio", "studio0"]);
  });

  test("the selection survives a relaunch through storage", async () => {
    const storage = memoryStorage();
    const nav = createNavigation({ app: withData({ local: 3 }), storage });

    nav.actions.selectShortcut(2);
    nav.actions.showSidebar("needs-you");
    await Bun.sleep(350);

    const reloaded = loadNav(storage);

    expect([String(reloaded.workspaceId), reloaded.sidebar]).toEqual(["local2", "needs-you"]);
    expect(loadNav(null).workspaceId).toBeNull();
  });

  test("the resolved selection is the same object until it changes", () => {
    const nav = createNavigation({ app: withData({ local: 2 }), storage: null });
    const first = nav.current();

    nav.actions.setJumpOpen(true);
    expect(nav.current()).toBe(first);
    nav.actions.selectShortcut(1);
    expect(nav.current()).not.toBe(first);
  });
});
