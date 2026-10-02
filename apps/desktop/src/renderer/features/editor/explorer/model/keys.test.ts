import { describe, expect, test } from "bun:test";
import { rootFor } from "../data/reveal.ts";
import { treeKey } from "./keys.ts";
import type { TreeRow } from "./tree.ts";

const row = (path: string, depth: number, patch: Partial<TreeRow> = {}): TreeRow => ({
  path,
  toggle: path,
  label: path.split("/").at(-1)!,
  kind: "file",
  depth,
  open: false,
  git: null,
  dirty: false,
  agent: null,
  hand: false,
  deleted: false,
  listing: null,
  ...patch,
});

const rows = [
  row("/w/src", 0, { kind: "folder", open: true }),
  row("/w/src/a.ts", 1),
  row("/w/src/gone.ts", 1, { deleted: true }),
  row("/w/lib", 0, { kind: "folder" }),
];

const press = (key: string, focused: string | null, meta = false) =>
  treeKey({ key, meta }, rows, focused);

describe("treeKey", () => {
  test("↑/↓ move, clamped; nothing focused focuses the first row", () => {
    expect(press("ArrowDown", "/w/src")).toEqual({ kind: "focus", path: "/w/src/a.ts" });
    expect(press("ArrowUp", "/w/src")).toEqual({ kind: "focus", path: "/w/src" });
    expect(press("End", "/w/src")).toEqual({ kind: "focus", path: "/w/lib" });
    expect(press("ArrowDown", null)).toEqual({ kind: "focus", path: "/w/src" });
  });

  test("→ opens a closed folder or steps in; ← closes or steps out", () => {
    expect(press("ArrowRight", "/w/lib")).toMatchObject({ kind: "toggle", open: true });
    expect(press("ArrowRight", "/w/src")).toEqual({ kind: "focus", path: "/w/src/a.ts" });
    expect(press("ArrowLeft", "/w/src")).toMatchObject({ kind: "toggle", open: false });
    expect(press("ArrowLeft", "/w/src/a.ts")).toEqual({ kind: "focus", path: "/w/src" });
  });

  test("↵ opens a file, F2 renames, ⌘⌫ deletes; a deleted file does neither", () => {
    expect(press("Enter", "/w/src/a.ts")).toMatchObject({ kind: "open" });
    expect(press("F2", "/w/src/a.ts")).toMatchObject({ kind: "rename" });
    expect(press("Backspace", "/w/src/a.ts")).toBeNull();
    expect(press("Backspace", "/w/src/a.ts", true)).toMatchObject({ kind: "delete" });
    expect(press("F2", "/w/src/gone.ts")).toBeNull();
    expect(press("Backspace", "/w/src/gone.ts", true)).toBeNull();
  });
});

describe("rootFor", () => {
  test("the Workspace's folder unless the path is outside it", () => {
    expect(rootFor("/w/src", true, null, "/w")).toBeNull();
    expect(rootFor("/w.worktrees/.review/pr-1", true, null, "/w")).toBe(
      "/w.worktrees/.review/pr-1"
    );
    expect(rootFor("/other/a.ts", false, null, "/w")).toBe("/other");
  });

  test("a checkout root shown already keeps holding its own paths", () => {
    expect(rootFor("/c/src/a.ts", false, "/c", "/w")).toBe("/c");
    expect(rootFor("/w/a.ts", false, "/c", "/w")).toBeNull();
  });
});
