import { describe, expect, test } from "bun:test";
import { shortcutSections } from "./ShortcutHelp.tsx";

const keysOf = (platform: "mac" | "windows") =>
  shortcutSections(platform).flatMap((s) => s.rows.map((r) => `${r.title}: ${r.keys.join(" ")}`));

describe("the shortcut overlay", () => {
  test("on Windows every key is spelled out, with the Windows table", () => {
    const rows = keysOf("windows");

    expect(rows.filter((r) => /[⌘⌥⇧⌃↵]/.test(r))).toEqual([]);
    expect(rows).toContain("Workspace or machine 1–10: Alt+1…Alt+0");
    expect(rows).toContain("Next session: Ctrl+PageDown");
    expect(rows).toContain("Show or hide output: Ctrl+Shift+B");
    expect(rows).toContain("Queue a follow-up for after the turn: Ctrl+Enter");
    expect(rows.some((r) => r.startsWith("Close other tabs"))).toBe(false);
  });

  test("macOS keeps its glyphs", () => {
    const rows = keysOf("mac");

    expect(rows).toContain("Workspace or machine 1–10: ⌃1…⌃0 ⌥1…⌥0");
    expect(rows).toContain("Next session: ⌥⌘↓");
    expect(rows).toContain("Queue a follow-up for after the turn: ⌘↵");
  });
});
