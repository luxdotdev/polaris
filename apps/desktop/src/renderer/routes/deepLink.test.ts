import { describe, expect, test } from "bun:test";
import { HostId, HostInfo, SessionId, WorkspaceId } from "@polaris/protocol";
import { createStore } from "zustand/vanilla";
import type { HostView } from "../../shared/api.ts";
import type { DeepLink } from "../../shared/deepLink.ts";
import { type AppState, initialState } from "../store/store.ts";
import { onDeepLinkEvent } from "./deepLink.ts";
import { hostView } from "./fixtures.testing.ts";
import type { SessionTarget, WorkspaceTarget } from "./navigation.ts";

const connected = (key: string, hostId: string): HostView => {
  const view = hostView(key);

  return {
    ...view,
    status: {
      ...view.status,
      host: new HostInfo({
        hostId: HostId.make(hostId),
        hostname: key,
        platform: "darwin",
        daemonVersion: "0.2.2",
        homeDir: "/Users/me",
        startedAt: "2026-10-23T00:00:00Z",
      }),
    },
  };
};

const harness = (hosts: ReadonlyArray<HostView>) => {
  const app = createStore<AppState>(() => ({ ...initialState, hosts }));
  const opened: Array<unknown> = [];

  const actions = {
    selectSession: (target: SessionTarget) => opened.push({ session: target }),
    selectWorkspace: (target: WorkspaceTarget) => opened.push({ workspace: target }),
  };

  return { app, opened, actions };
};

const session = (hostId: string, id: string): DeepLink => ({
  target: "session",
  hostId: HostId.make(hostId),
  sessionId: SessionId.make(id),
});

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("onDeepLinkEvent", () => {
  test("opens a session or a Workspace on the Host with that hostId", () => {
    const h = harness([connected("local", "h-local"), connected("pi", "h-pi")]);

    onDeepLinkEvent(session("h-pi", "s1"), h.app, h.actions);
    onDeepLinkEvent(
      { target: "workspace", hostId: HostId.make("h-local"), workspaceId: WorkspaceId.make("w1") },
      h.app,
      h.actions
    );
    expect(h.opened).toEqual([
      { session: { hostKey: "pi", sessionId: "s1" } },
      { workspace: { hostKey: "local", workspaceId: "w1" } },
    ]);
  });

  test("waits for a Host that is still reconnecting", () => {
    const h = harness([hostView("pi", "reconnecting")]);

    onDeepLinkEvent(session("h-pi", "s1"), h.app, h.actions);
    expect(h.opened).toEqual([]);
    h.app.setState({ hosts: [connected("pi", "h-pi")] });
    expect(h.opened).toEqual([{ session: { hostKey: "pi", sessionId: "s1" } }]);
  });

  test("gives up on a Host that never connects", async () => {
    const h = harness([]);

    onDeepLinkEvent(session("h-gone", "s1"), h.app, h.actions, 1);
    await nextTick();
    h.app.setState({ hosts: [connected("late", "h-gone")] });
    expect(h.opened).toEqual([]);
  });

  test("a newer link replaces one still waiting", () => {
    const h = harness([connected("local", "h-local")]);

    onDeepLinkEvent(session("h-pi", "s1"), h.app, h.actions);
    onDeepLinkEvent(session("h-local", "s2"), h.app, h.actions);
    h.app.setState({ hosts: [connected("local", "h-local"), connected("pi", "h-pi")] });
    expect(h.opened).toEqual([{ session: { hostKey: "local", sessionId: "s2" } }]);
  });
});
