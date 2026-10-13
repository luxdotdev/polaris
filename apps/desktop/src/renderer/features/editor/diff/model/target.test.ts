import { describe, expect, test } from "bun:test";
import { pairOf, sideOf, sizeLabel, MAX_DIFF_BYTES, MAX_DIFF_LINES } from "./content.ts";
import { formatPrefs, parsePrefs } from "./prefs.ts";
import { step } from "./stops.ts";
import { diffTabId, diffTitle, sideLabels, sourcesOf, targetOf } from "./target.ts";

const where = { hostKey: "local", workspaceId: "w", toplevel: "/repo" };

const entry = (path: string, origPath: string | null = null) => ({
  path,
  origPath,
  index: "M",
  worktree: "M",
});

describe("targets", () => {
  test("Changes compares the working tree with the index", () => {
    const target = targetOf(where, entry("src/main.ts"), "unstaged", "modified");

    expect(target === null ? null : sourcesOf(target)).toEqual({
      old: { kind: "git", revision: "", path: "src/main.ts" },
      new: { kind: "file", path: "/repo/src/main.ts" },
    });
    expect(target === null ? null : diffTitle(target)).toBe("main.ts (Working Tree)");
  });

  test("Staged compares the index with HEAD, under a rename's old name", () => {
    const target = targetOf(where, entry("src/new.ts", "src/old.ts"), "staged", "renamed");

    expect(target === null ? null : sourcesOf(target)).toEqual({
      old: { kind: "git", revision: "HEAD", path: "src/old.ts" },
      new: { kind: "git", revision: "", path: "src/new.ts" },
    });
    expect(target === null ? null : diffTitle(target)).toBe("new.ts (Index)");
    expect(target === null ? null : sideLabels(target)).toBe("HEAD ↔ Index");
  });

  test("added, untracked and deleted files have an empty side", () => {
    const sources = (
      side: "staged" | "unstaged" | "head",
      git: "added" | "untracked" | "deleted"
    ) => {
      const target = targetOf(where, entry("a.ts"), side, git);

      return target === null ? null : sourcesOf(target);
    };

    expect(sources("staged", "added")?.old).toEqual({ kind: "none" });
    expect(sources("unstaged", "untracked")?.old).toEqual({ kind: "none" });
    expect(sources("unstaged", "deleted")?.new).toEqual({ kind: "none" });
    expect(sources("staged", "deleted")?.new).toEqual({ kind: "none" });
    expect(sources("head", "untracked")).toEqual({
      old: { kind: "none" },
      new: { kind: "file", path: "/repo/a.ts" },
    });
  });

  test("a conflicted file compares the working tree with HEAD; an untracked folder has no diff", () => {
    expect(targetOf(where, entry("a.ts"), "unstaged", "conflicted")?.side).toBe("head");
    expect(targetOf(where, entry("build/"), "unstaged", "untracked")).toBeNull();
  });

  test("one tab per file and side", () => {
    expect(diffTabId({ side: "staged", path: "/repo/a.ts" })).not.toBe(
      diffTabId({ side: "unstaged", path: "/repo/a.ts" })
    );
  });
});

describe("content", () => {
  test("text, binary and too large", () => {
    expect(sideOf({ kind: "text", text: "a\n" }, 2)).toEqual({ kind: "text", text: "a\n" });
    expect(sideOf({ kind: "bytes", bytes: new Uint8Array([0xff, 0xfe, 0x00]) }, 3).kind).toBe(
      "binary"
    );
    expect(sideOf({ kind: "text", text: "a\u0000b" }, 3).kind).toBe("binary");
    expect(sideOf({ kind: "text", text: "" }, MAX_DIFF_BYTES + 1).kind).toBe("too-large");
    expect(sideOf({ kind: "text", text: "\n".repeat(MAX_DIFF_LINES) }, 10).kind).toBe("too-large");
  });

  test("a pair: binary wins, then size, then sameness", () => {
    const text = (t: string) => ({ kind: "text" as const, text: t });

    expect(pairOf({ kind: "binary", size: 1 }, { kind: "too-large", size: 9 })).toEqual({
      kind: "binary",
    });
    expect(pairOf(text("a"), { kind: "too-large", size: 2_400_000 })).toEqual({
      kind: "too-large",
      size: 2_400_000,
    });
    expect(pairOf(text("a"), text("a"))).toEqual({ kind: "same" });
    expect(pairOf(text("a"), text("b"))).toEqual({ kind: "text", old: "a", new: "b" });
    expect(sizeLabel(2_400_000)).toBe("2.4 MB");
    expect(sizeLabel(512)).toBe("512 bytes");
  });
});

describe("prefs and stops", () => {
  test("prefs round-trip; anything unknown is the default", () => {
    expect(parsePrefs(formatPrefs({ style: "split", syntax: false }))).toEqual({
      style: "split",
      syntax: false,
    });
    expect(parsePrefs("garbage")).toEqual({ style: "unified", syntax: true });
  });

  test("F7 steps forward and wraps; ⇧F7 starts from the last", () => {
    expect(step(3, -1, 1)).toBe(0);
    expect(step(3, 2, 1)).toBe(0);
    expect(step(3, -1, -1)).toBe(2);
    expect(step(3, 0, -1)).toBe(2);
    expect(step(0, -1, 1)).toBe(-1);
  });
});
