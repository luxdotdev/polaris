import { describe, expect, test } from "bun:test";
import { hostModel, hostView, workspaces } from "./fixtures.testing.ts";
import { barHosts, barWorkspaces, shortcutLabel, summarize, topBarMode } from "./topBar.ts";

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
    expect([0, 8, 9, 10].map(shortcutLabel)).toEqual(["⌃1", "⌃9", "⌃0", undefined]);
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
});
