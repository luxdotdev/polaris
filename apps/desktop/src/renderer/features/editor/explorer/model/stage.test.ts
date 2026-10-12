import { describe, expect, test } from "bun:test";
import { noAgents } from "./agents.ts";
import type { StatusEntry } from "./git.ts";
import { canCommit, commitLabel, stageLists } from "./stage.ts";

const entry = (xy: string, path: string, origPath: string | null = null): StatusEntry => ({
  path,
  origPath,
  index: xy[0]!,
  worktree: xy[1]!,
});

const summary = (lists: ReturnType<typeof stageLists>) => ({
  staged: lists.staged.map((r) => `${r.git} ${r.folder}/${r.name} ${r.paths.join(",")}`),
  unstaged: lists.unstaged.map((r) => `${r.git} ${r.folder}/${r.name}${r.untracked ? " U" : ""}`),
});

describe("stageLists", () => {
  test("splits each entry by side of the index, a file edited after staging on both", () => {
    const lists = stageLists(
      "/r",
      "/r",
      [
        entry("M.", "src/a.ts"),
        entry(".M", "src/b.ts"),
        entry("MM", "c.ts"),
        entry("A.", "new.ts"),
        entry(".D", "gone.ts"),
        entry("R.", "src/to.ts", "src/from.ts"),
        entry("??", "loose/"),
        entry("!!", "node_modules/"),
        entry("UU", "both.ts"),
      ],
      noAgents
    );

    expect(summary(lists)).toEqual({
      staged: [
        "modified /c.ts c.ts",
        "added /new.ts new.ts",
        "modified src/a.ts src/a.ts",
        "renamed src/to.ts src/to.ts,src/from.ts",
      ],
      unstaged: [
        "conflicted /both.ts",
        "modified /c.ts",
        "deleted /gone.ts",
        "untracked /loose U",
        "modified src/b.ts",
      ],
    });
  });

  test("keeps only paths under the explorer's root, folders relative to it", () => {
    const lists = stageLists(
      "/r",
      "/r/app",
      [entry(".M", "app/x/y.ts"), entry(".M", "z.ts")],
      noAgents
    );

    expect(lists.unstaged.map((r) => [r.folder, r.name, r.paths[0]])).toEqual([
      ["x", "y.ts", "app/x/y.ts"],
    ]);
  });
});

describe("the commit button", () => {
  test("counts staged files and stays off without a message or anything staged", () => {
    expect([0, 1, 3].map(commitLabel)).toEqual(["Commit", "Commit 1 file", "Commit 3 files"]);
    expect(canCommit("fix: x", 2, false)).toBe(true);
    expect(canCommit("  \n", 2, false)).toBe(false);
    expect(canCommit("fix: x", 0, false)).toBe(false);
    expect(canCommit("fix: x", 2, true)).toBe(false);
  });
});
