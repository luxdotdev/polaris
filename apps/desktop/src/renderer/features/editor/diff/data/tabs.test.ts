import { describe, expect, test } from "bun:test";
import type { DiffTarget } from "../model/target.ts";
import { type DiffTab, withClosed, withOpened } from "./tabs.ts";

const target = (path: string): DiffTarget => ({
  hostKey: "local",
  workspaceId: "w",
  toplevel: "/repo",
  path: `/repo/${path}`,
  repoPath: path,
  origRepoPath: null,
  side: "unstaged",
  git: "modified",
});

const tab = (path: string, preview = true): DiffTab => ({
  id: path,
  target: target(path),
  preview,
});

describe("diff tabs", () => {
  test("a preview replaces the preview; a kept tab stays", () => {
    const one = withOpened({ tabs: [], active: null }, tab("a.ts"));
    const two = withOpened(one, tab("b.ts"));

    expect(two.tabs.map((t) => t.id)).toEqual(["b.ts"]);

    const kept = withOpened(two, tab("b.ts", false));
    const three = withOpened(kept, tab("c.ts"));

    expect(three.tabs.map((t) => [t.id, t.preview])).toEqual([
      ["b.ts", false],
      ["c.ts", true],
    ]);
    expect(three.active).toBe("c.ts");
  });

  test("opening a kept tab as a preview keeps it", () => {
    const kept = withOpened({ tabs: [], active: null }, tab("a.ts", false));

    expect(withOpened(kept, tab("a.ts")).tabs[0]?.preview).toBe(false);
  });

  test("closing the shown diff shows the file tabs, else the diff on its left", () => {
    const diffs = { tabs: [tab("a.ts", false), tab("b.ts", false)], active: "b.ts" };

    expect(withClosed(diffs, "b.ts", true).active).toBeNull();
    expect(withClosed(diffs, "b.ts", false).active).toBe("a.ts");
    expect(withClosed(diffs, "a.ts", false)).toEqual({
      tabs: [tab("b.ts", false)],
      active: "b.ts",
    });
  });
});
