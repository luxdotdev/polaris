import { describe, expect, test } from "bun:test";
import { SessionId, WorkspaceId } from "@polaris/protocol";
import { hostModel, hostView } from "./fixtures.testing.ts";
import { initialNav, resolveSelection, workspaceKey } from "./selection.ts";
import { barHosts } from "./topBar.ts";

const models = {
  local: hostModel([
    {
      id: "a",
      sessions: [
        { id: "old", state: "idle", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "new", state: "idle", createdAt: "2026-09-02T00:00:00.000Z" },
        { id: "waiting", state: "needs-you", createdAt: "2026-08-01T00:00:00.000Z" },
      ],
    },
    { id: "b" },
  ]),
  studio: hostModel([{ id: "c", sessions: [{ id: "c1", state: "working" }] }]),
};

const bar = barHosts({ hosts: [hostView("local"), hostView("studio")], models });

const resolve = (nav: Partial<typeof initialNav>) =>
  resolveSelection({ nav: { ...initialNav, ...nav }, bar, models });

describe("selection", () => {
  test("nothing chosen yet: the first chip, and its loudest session (needs you first)", () => {
    const s = resolve({});

    expect([s.hostKey, s.workspaceId, s.sessionId]).toEqual(["local", "a", "waiting"]);
  });

  test("a Workspace that is gone falls back to the first chip", () => {
    expect(
      resolve({ hostKey: "local", workspaceId: WorkspaceId.make("gone") }).workspaceId
    ).toEqual(WorkspaceId.make("a"));
  });

  test("switching back restores the session last open there", () => {
    const s = resolve({
      hostKey: "local",
      workspaceId: WorkspaceId.make("a"),
      lastSession: { [workspaceKey("local", "a")]: SessionId.make("old") },
    });

    expect(s.sessionId).toEqual(SessionId.make("old"));
  });

  test("a chosen session decides its Workspace, on any Host", () => {
    const s = resolve({
      hostKey: "studio",
      workspaceId: WorkspaceId.make("a"),
      sessionId: SessionId.make("c1"),
    });

    expect([s.hostKey, s.workspaceId, s.sessionId]).toEqual(["studio", "c", "c1"]);
  });

  test("an empty Workspace has no session; a new-session pane has none either", () => {
    expect(resolve({ hostKey: "local", workspaceId: WorkspaceId.make("b") }).sessionId).toBeNull();
    expect(resolve({ pane: "new-session" }).sessionId).toBeNull();
  });

  test("in the machine bar the Host is kept and its first Workspace used", () => {
    const s = resolve({ topBar: "machines", hostKey: "studio" });

    expect([s.hostKey, s.workspaceId]).toEqual(["studio", "c"]);
  });
});
