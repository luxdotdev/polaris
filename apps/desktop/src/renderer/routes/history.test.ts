import { describe, expect, test } from "bun:test";
import { SessionId, WorkspaceId } from "@polaris/protocol";
import { createStore } from "zustand/vanilla";
import { type AppState, initialState } from "../store/store.ts";
import { hostModel, hostView, type SessionSpec } from "./fixtures.testing.ts";
import { editPlaces } from "./history.ts";
import { createNavigation } from "./navigation.ts";
import { openPull, openSessionReview, reviewRoute } from "./review.ts";

// No animation frames under bun test; the switch timer only needs the function to exist.
globalThis.requestAnimationFrame ??= () => 0;

const sessions = (archived: ReadonlyArray<string> = []) => {
  const spec = (id: string): SessionSpec => ({
    id,
    state: archived.includes(id) ? "archived" : "idle",
  });

  return hostModel([
    { id: "w0", sessions: [spec("a"), spec("b")] },
    { id: "w1", sessions: [spec("c")] },
  ]);
};

const setup = () => {
  reviewRoute.setState({ subject: null });

  const app = createStore<AppState>(() => ({
    ...initialState,
    hosts: [hostView("local")],
    hostModels: { local: sessions() },
  }));

  const nav = createNavigation({ app, storage: null });

  const open = (id: string) =>
    nav.actions.selectSession({ hostKey: "local", sessionId: SessionId.make(id) });

  const shown = () => nav.current().sessionId;

  return { app, nav, open, shown };
};

describe("page history", () => {
  test("back and forward step through the sessions shown, across Workspaces", () => {
    const { nav, open, shown } = setup();

    open("a");
    open("c");
    open("b");
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("c"));
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("a"));
    expect(nav.actions.canGoBack()).toBe(false);
    nav.actions.forward();
    nav.actions.forward();
    expect(shown()).toBe(SessionId.make("b"));
    expect(nav.actions.canGoForward()).toBe(false);
  });

  test("opening a session after going back drops the pages ahead, as in a browser", () => {
    const { nav, open, shown } = setup();

    open("a");
    open("b");
    nav.actions.back();
    open("c");
    expect(nav.actions.canGoForward()).toBe(false);
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("a"));
  });

  test("a Workspace switch that restores its session counts as a visit", () => {
    const { nav, open, shown } = setup();

    open("c");
    open("a");
    nav.actions.selectWorkspace({ hostKey: "local", workspaceId: WorkspaceId.make("w1") });
    expect(shown()).toBe(SessionId.make("c"));
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("a"));
  });

  test("back from the new-session page returns to the session it covered", () => {
    const { nav, open, shown } = setup();

    open("a");
    open("b");
    nav.actions.startNewSession();
    nav.actions.back();
    expect([shown(), nav.current().pane]).toEqual([SessionId.make("b"), "session"]);
  });

  test("an archived session is skipped", () => {
    const { app, nav, open, shown } = setup();

    open("a");
    open("b");
    open("c");
    app.setState({ hostModels: { local: sessions(["b"]) } });
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("a"));
  });

  test("a Review subject is a page between sessions", () => {
    const { nav, open, shown } = setup();
    const pull = { repo: { owner: "acme", name: "app" }, number: 7, pullId: null };

    open("a");
    openPull(nav.actions, pull);
    open("b");
    nav.actions.back();
    expect([nav.current().mode, reviewRoute.getState().subject]).toEqual([
      "review",
      { kind: "pull", pull },
    ]);
    nav.actions.back();
    expect([nav.current().mode, shown()]).toEqual(["orchestrate", SessionId.make("a")]);
    nav.actions.forward();
    nav.actions.forward();
    expect([nav.current().mode, shown()]).toEqual(["orchestrate", SessionId.make("b")]);
  });

  test("going back through Review doesn't drop the pages ahead", () => {
    const { nav, open, shown } = setup();

    open("a");
    openSessionReview(nav.actions, "local", SessionId.make("c"));
    open("b");
    nav.actions.back();
    nav.actions.back();
    expect(shown()).toBe(SessionId.make("a"));
    expect(nav.actions.canGoForward()).toBe(true);
    nav.actions.forward();
    expect(reviewRoute.getState().subject).toEqual({
      kind: "session",
      hostKey: "local",
      sessionId: SessionId.make("c"),
    });
  });

  test("in Edit, Back and Forward are the Editor's", () => {
    const { nav, open, shown } = setup();
    const ran: Array<string> = [];

    editPlaces.current = {
      back: () => void ran.push("back"),
      forward: () => void ran.push("forward"),
      canGoBack: () => true,
      canGoForward: () => false,
    };

    open("a");
    open("b");
    nav.actions.setMode("edit");
    nav.actions.back();
    expect([ran, nav.actions.canGoForward(), shown()]).toEqual([
      ["back"],
      false,
      SessionId.make("b"),
    ]);
    editPlaces.current = null;
  });
});
