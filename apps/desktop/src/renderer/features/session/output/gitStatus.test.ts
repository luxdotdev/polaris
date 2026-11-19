import { expect, test } from "bun:test";
import { branchLine, type GitFacts } from "./gitStatus.ts";

const refused: GitFacts = { kind: "none", message: "This isn't shared with you" };

test("a refused git status reads as no repository on your Host, and as nothing on a Host shared with you", () => {
  expect([branchLine(refused, false), branchLine(refused, true)]).toEqual([
    "Not a git repository",
    null,
  ]);
});

test("a branch shows either way, and a detached HEAD says so", () => {
  expect([
    branchLine({ kind: "ready", branch: "main", changed: 0, ahead: 0, behind: 0 }, true),
    branchLine({ kind: "ready", branch: null, changed: 0, ahead: 0, behind: 0 }, false),
  ]).toEqual(["main", "detached HEAD"]);
});
