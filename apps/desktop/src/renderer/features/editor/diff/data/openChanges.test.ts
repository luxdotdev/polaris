import { describe, expect, test } from "bun:test";
import type { GitFacts } from "../../explorer/data/store.ts";
import { gitMarks, type StatusEntry } from "../../explorer/model/git.ts";
import { type DiffTarget, sourcesOf } from "../model/target.ts";
import { liveTarget } from "./openChanges.ts";

const facts = (entries: ReadonlyArray<StatusEntry>): GitFacts => ({
  toplevel: "/repo",
  worktree: false,
  head: "abc",
  branch: "main",
  ahead: 0,
  marks: gitMarks("/repo", "/repo", entries),
  entries,
});

const tab = (side: DiffTarget["side"], git: DiffTarget["git"]): DiffTarget => ({
  hostKey: "local",
  workspaceId: "w",
  toplevel: "/repo",
  path: "/repo/new.ts",
  repoPath: "new.ts",
  origRepoPath: null,
  side,
  git,
});

describe("an open diff tab follows git", () => {
  test("after `git add`, an untracked file's Changes tab compares the index, not an empty file", () => {
    const added = facts([{ path: "new.ts", origPath: null, index: "A", worktree: "." }]);

    expect(sourcesOf(liveTarget(tab("unstaged", "untracked"), added)).old).toEqual({
      kind: "git",
      revision: "",
      path: "new.ts",
    });
  });

  test("after a commit, a staged file's tab compares HEAD with the index, which now match", () => {
    expect(sourcesOf(liveTarget(tab("staged", "added"), facts([])))).toEqual({
      old: { kind: "git", revision: "HEAD", path: "new.ts" },
      new: { kind: "git", revision: "", path: "new.ts" },
    });
  });

  test("an edit after staging keeps the Changes tab on index ↔ working tree", () => {
    const edited = facts([{ path: "new.ts", origPath: null, index: "A", worktree: "M" }]);

    expect(sourcesOf(liveTarget(tab("unstaged", "untracked"), edited))).toEqual({
      old: { kind: "git", revision: "", path: "new.ts" },
      new: { kind: "file", path: "/repo/new.ts" },
    });
  });
});
