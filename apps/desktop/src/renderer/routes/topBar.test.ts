import { describe, expect, test } from "bun:test";
import { hostModel, hostView, workspaces } from "./fixtures.testing.ts";
import { WorkspaceId } from "@polaris/protocol";
import {
  barHosts,
  barWorkspaces,
  hiddenWorkspaces,
  shortcutLabel,
  shownWorkspaces,
  summarize,
  topBarMode,
} from "./topBar.ts";

describe("top bar mode (ENG-177)", () => {
  test("Workspace chips up to 10, the machine bar from 11", () => {
    expect(topBarMode({ workspaces: 10, hosts: 3, previous: "workspaces" })).toBe("workspaces");
    expect(topBarMode({ workspaces: 11, hosts: 3, previous: "workspaces" })).toBe("machines");
  });

  test("hysteresis: the machine bar stays until 9, so it never flips at 10/11", () => {
    expect(topBarMode({ workspaces: 10, hosts: 3, previous: "machines" })).toBe("machines");
    expect(topBarMode({ workspaces: 9, hosts: 3, previous: "machines" })).toBe("workspaces");
  });

  test("a single machine in machine mode hides the bar; with few Workspaces it keeps its chips", () => {
    expect(topBarMode({ workspaces: 12, hosts: 1, previous: "workspaces" })).toBe("hidden");
    expect(topBarMode({ workspaces: 10, hosts: 1, previous: "hidden" })).toBe("hidden");
    expect(topBarMode({ workspaces: 3, hosts: 1, previous: "hidden" })).toBe("workspaces");
  });

  test("⌃1…⌃9 then ⌃0 for the tenth, nothing after", () => {
    expect([0, 8, 9, 10].map((i) => shortcutLabel(i, "mac"))).toEqual([
      "⌃1",
      "⌃9",
      "⌃0",
      undefined,
    ]);
    expect([0, 9].map((i) => shortcutLabel(i, "windows"))).toEqual(["Ctrl+1", "Ctrl+0"]);
  });
});

describe("bar contents", () => {
  test("every shown Workspace on every Host, remote Hosts first and this Mac last; hidden ones left out", () => {
    const bar = barHosts({
      hosts: [hostView("local"), hostView("studio")],
      models: {
        local: hostModel([{ id: "a" }, { id: "b", hidden: true }]),
        studio: hostModel(workspaces("s", 2)),
      },
    });

    expect(barWorkspaces(bar).map((w) => `${w.hostKey}/${w.workspace.name}`)).toEqual([
      "studio/s0",
      "studio/s1",
      "local/a",
    ]);
  });

  test("a chip shows its loudest session: needs you over failed over working", () => {
    const model = hostModel([
      {
        id: "a",
        sessions: [
          { id: "1", state: "idle" },
          { id: "2", state: "working" },
          { id: "3", state: "needs-you" },
          { id: "4", state: "failed" },
          { id: "5", state: "archived" },
        ],
      },
    ]);

    const summary = summarize(
      [...model.sessions.values()].filter((e) => e.session.state !== "archived")
    );

    expect(summary.state).toBe("needs-you");
    expect(summary.needsYou).toBe(1);
    expect(summary.sessions).toBe(4);
    expect(summarize([]).state).toBeNull();
  });

  test("a session dismissed from Needs You on this Mac doesn't count on its chip", () => {
    const bar = barHosts({
      hosts: [hostView("local")],
      models: {
        local: hostModel([
          {
            id: "a",
            sessions: [
              { id: "1", state: "needs-you" },
              { id: "2", state: "working" },
            ],
          },
        ]),
      },
      quiet: new Set(["local\u00001"]),
    });

    const chip = barWorkspaces(bar)[0]?.summary;

    expect(chip?.needsYou).toBe(0);
    expect(chip?.state).toBe("working");
    expect(bar[0]?.summary.needsYou).toBe(0);
  });
});

describe("hidden Workspaces", () => {
  const hosts = [hostView("local")];

  const models = {
    local: hostModel([
      { id: "a" },
      { id: "quiet", hidden: true, sessions: [{ id: "q1", state: "working" }] },
      { id: "asks", hidden: true, sessions: [{ id: "n1", state: "needs-you" }] },
      { id: "b" },
    ]),
  };

  const listed = (bar: ReturnType<typeof barHosts>) =>
    bar.flatMap((h) => h.workspaces).map((w) => `${w.workspace.name}${w.hidden ? "*" : ""}`);

  test("a hidden one is listed after the shown ones only while it is open or needs you", () => {
    expect(listed(barHosts({ hosts, models }))).toEqual(["a", "b", "asks*"]);

    const open = { hostKey: "local", workspaceId: WorkspaceId.make("quiet") };

    expect(listed(barHosts({ hosts, models, open }))).toEqual(["a", "b", "quiet*", "asks*"]);
  });

  test("a needs-you session dismissed on this Mac doesn't bring its hidden Workspace back", () => {
    const quiet = new Set(["local\u0000n1"]);

    expect(listed(barHosts({ hosts, models, quiet }))).toEqual(["a", "b"]);
  });

  test("hidden chips take no ⌃N and don't count towards the machine bar", () => {
    const bar = barHosts({ hosts, models });

    expect(barWorkspaces(bar).map((w) => w.workspace.name)).toEqual(["a", "b"]);
  });

  test("the Host still counts what needs you in its hidden Workspaces", () => {
    expect(barHosts({ hosts, models })[0]?.summary.needsYou).toBe(1);
  });

  test("shown and hidden lists split every Workspace, oldest first", () => {
    expect(shownWorkspaces(models.local).map((w) => w.name)).toEqual(["a", "b"]);
    expect(hiddenWorkspaces(models.local).map((w) => w.name)).toEqual(["quiet", "asks"]);
  });
});
