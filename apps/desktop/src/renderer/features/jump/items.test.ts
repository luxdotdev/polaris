import { describe, expect, test } from "bun:test";
import { hostModel, hostView } from "../../routes/fixtures.testing.ts";
import { barHosts, shortcutLabel } from "../../routes/topBar.ts";
import { jumpGroups } from "./groups.ts";
import { hostItems, sessionItems, workspaceItems, worktreeItems } from "./items.ts";

const models = {
  local: hostModel([
    { id: "polaris" },
    { id: "sightline", hidden: true, sessions: [{ id: "s1", state: "idle" }] },
  ]),
};

const data = { bar: barHosts({ hosts: [hostView("local")], models }), models, machineBar: false };

describe("jump menu Workspaces", () => {
  test("hidden ones are listed after the chips, marked hidden, with no ⌃N", () => {
    expect(workspaceItems(data).map((i) => [i.title, i.meta])).toEqual([
      ["polaris", shortcutLabel(0) ?? ""],
      ["sightline", "hidden"],
    ]);
  });

  test("a hidden one is found by name, or by the word hidden", () => {
    const sources = {
      sessions: sessionItems(data),
      workspaces: workspaceItems(data),
      worktrees: worktreeItems(data),
      hosts: hostItems(data),
    };

    const found = (query: string) =>
      jumpGroups({ query, sources, recent: [] })
        .find((g) => g.heading === "Workspaces")
        ?.items.map((i) => i.title);

    expect(found("sight")).toEqual(["sightline"]);
    expect(found("hidden")).toEqual(["sightline"]);
  });

  test("a machine's count is of its shown Workspaces", () => {
    expect(hostItems(data)[0]?.detail).toBe("1 workspace");
  });
});
