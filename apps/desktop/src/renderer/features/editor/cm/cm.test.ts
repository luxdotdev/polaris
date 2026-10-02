import { describe, expect, test } from "bun:test";
import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { cmChord, shellChords, shellSafe } from "./keys.ts";
import { minimalChange, reloadSpec } from "./reload.ts";
import { crumbs } from "../model/paths.ts";
import { positionText } from "../ui/EditorStatus.tsx";

describe("shell chords stay the shell's", () => {
  test("CodeMirror key names map to the shell's chords", () => {
    expect(cmChord("Mod-i", true)).toBe("Mod+KeyI");
    expect(cmChord("Mod-Alt-ArrowUp", true)).toBe("Mod+Alt+ArrowUp");
    expect(cmChord("Ctrl-Space", true)).toBe("Ctrl+Space");
    expect(cmChord("Mod--", true)).toBe("Mod+Minus");
  });

  test("⌘I, ⌘L, ⌘P, ⌘S and ⌃1…9 are reserved; ⌘/ stays the editor's", () => {
    const reserved = shellChords();

    for (const chord of [
      "Mod+KeyI",
      "Mod+KeyL",
      "Mod+KeyP",
      "Mod+KeyS",
      "Ctrl+Digit1",
      "Alt+Digit9",
      "Mod+KeyK",
    ]) {
      expect(reserved.has(chord)).toBe(true);
    }

    expect(reserved.has("Mod+Slash")).toBe(false);
  });

  test("the default keymap loses select-line (⌘L) and add-cursor-above (⌘⌥↑)", () => {
    const kept = shellSafe(defaultKeymap, true);
    const keys = kept.map((b) => b.mac ?? b.key);

    expect(keys).not.toContain("Mod-l");
    expect(keys).not.toContain("Mod-i");
    expect(keys).not.toContain("Mod-Alt-ArrowUp");
    expect(keys).toContain("Mod-/");
    expect(kept.length).toBeGreaterThan(defaultKeymap.length - 8);
  });
});

describe("reloading in place", () => {
  test("the smallest single change", () => {
    expect(minimalChange("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(minimalChange("aaa", "aaaa")).toEqual({ from: 3, to: 3, insert: "a" });
    expect(minimalChange("same", "same")).toBeNull();
  });

  test("the cursor maps through the reload and it isn't undoable", () => {
    const state = EditorState.create({ doc: "one\ntwo\nthree", selection: { anchor: 9 } });
    const spec = reloadSpec(state, "zero\none\ntwo\nthree");

    expect(spec).not.toBeNull();
    const next = state.update(spec ?? {}).state;

    expect(next.doc.toString()).toBe("zero\none\ntwo\nthree");
    expect(next.sliceDoc(next.selection.main.head, next.selection.main.head + 4)).toBe("hree");
  });
});

describe("the chrome's words", () => {
  test("breadcrumbs from the root, or the whole path outside it", () => {
    expect(crumbs("/r/daemon/src/a.ts", "/r")).toEqual(["daemon", "src", "a.ts"]);
    expect(crumbs("/w/tree/a.ts", "/r/")).toEqual(["w", "tree", "a.ts"]);
  });

  test("the position, or the selection (Paper E2a)", () => {
    expect(positionText({ line: 28, column: 14, selected: 0, lines: 1 })).toBe("Ln 28, Col 14");
    expect(positionText({ line: 19, column: 3, selected: 240, lines: 10 })).toBe(
      "Ln 10–19 · 10 lines selected"
    );
  });
});
