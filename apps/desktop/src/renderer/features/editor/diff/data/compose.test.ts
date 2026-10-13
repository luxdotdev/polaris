import { describe, expect, test } from "bun:test";
import { syntaxDiff } from "@polaris/syntax-diff";
import { typescriptTokenizer } from "@polaris/syntax-diff/typescript";
import type { DiffTarget } from "../model/target.ts";
import { stopsOf } from "../model/stops.ts";
import { composeDiff } from "./compose.ts";

const target: DiffTarget = {
  hostKey: "local",
  workspaceId: "w",
  toplevel: "/repo",
  path: "/repo/src/host.ts",
  repoPath: "src/host.ts",
  origRepoPath: null,
  side: "unstaged",
  git: "modified",
};

const BEFORE = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";

const syntax = (before: string, after: string) => ({
  kind: "ok" as const,
  ms: 0,
  ...syntaxDiff(before, after, "host.ts", typescriptTokenizer),
});

describe("composeDiff", () => {
  test("by line, Pierre diffs the full files: context can expand", () => {
    const after = BEFORE.replace("v10 = 10", "v10 = 100");
    const { diff, mode } = composeDiff(target, BEFORE, after, null);

    expect(mode).toBe("line");
    expect(diff.isPartial).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(stopsOf(diff)).toEqual([{ line: 11, side: "additions", order: 10 }]);
  });

  test("syntax-aware, an in-line insertion is one context row with its tokens marked", () => {
    const after = BEFORE.replace("v10 = 10;", "v10 = 10 as const;");
    const composed = composeDiff(target, BEFORE, after, syntax(BEFORE, after));

    expect(composed.mode).toBe("syntax");
    expect(composed.diff.isPartial).toBe(false);
    expect(composed.inserted).toEqual([11]);
    expect(composed.emphasis).toEqual([{ side: "new", line: 11, start: 22, end: 30 }]);
    expect(composed.diff.hunks.flatMap((h) => h.hunkContent.map((c) => c.type))).toEqual([
      "context",
    ]);
    expect(composed.diff.additionLines[10]).toBe("export const v10 = 10 as const;\n");
    expect(stopsOf(composed.diff, composed.inserted)).toEqual([
      { line: 11, side: "additions", order: 10 },
    ]);
  });

  test("syntax-aware, a modified line is a removal and an addition", () => {
    const after = BEFORE.replace("v10 = 10;", "v10 = 11;");
    const { diff, emphasis } = composeDiff(target, BEFORE, after, syntax(BEFORE, after));

    expect(diff.hunks[0]?.hunkContent.map((c) => c.type)).toEqual(["context", "change", "context"]);
    expect(emphasis.map((e) => e.side)).toEqual(["old", "new"]);
  });

  test("only spacing changed: the line diff, flagged", () => {
    const after = BEFORE.replace("v10 = 10;", "v10  =  10;");
    const composed = composeDiff(target, BEFORE, after, syntax(BEFORE, after));

    expect(composed.mode).toBe("line");
    expect(composed.spacingOnly).toBe(true);
  });

  test("syntax-aware that couldn't run: the line diff, with why", () => {
    const after = BEFORE.replace("v10 = 10;", "v10 = 11;");
    const line = { kind: "line", reason: "too-complex" } as const;
    const composed = composeDiff(target, BEFORE, after, line);

    expect(composed.mode).toBe("line");
    expect(composed.fallback).toBe("too-complex");
    expect(composeDiff(target, BEFORE, after, null).fallback).toBeNull();
  });

  test("a new file has only additions", () => {
    const { diff } = composeDiff({ ...target, git: "untracked" }, "", "a;\n", null);

    expect(diff.hunks[0]?.hunkContent.map((c) => c.type)).toEqual(["change"]);
  });
});
