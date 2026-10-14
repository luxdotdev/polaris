import { describe, expect, test } from "bun:test";
import { formatChord, isBare, parseChord } from "./chord.ts";
import {
  bindingOf,
  type CommandId,
  EDIT_CHORDS,
  fillTitle,
  holds,
  KEYMAP,
  paletteEntry,
} from "./keymap.ts";

describe("keymap", () => {
  test("every menu item a user can press shows a chord with a modifier", () => {
    for (const b of KEYMAP.filter((b) => b.menu !== undefined && b.keys.length > 0)) {
      expect(isBare(parseChord(b.keys[0] ?? ""))).toBe(false);
    }
  });
});

describe("command registry metadata", () => {
  test("conditions combine like when clauses", () => {
    const keys = new Set(["editor.file", "trust.known"] as const);

    expect(holds(undefined, keys)).toBe(true);
    expect(holds("editor.file", keys)).toBe(true);
    expect(holds({ not: "trust.trusted" }, keys)).toBe(true);
    expect(holds({ all: ["editor.file", "trust.trusted"] }, keys)).toBe(false);
    expect(holds({ any: ["workspace", "trust.known"] }, keys)).toBe(true);
  });

  test("titles fill from context values and refuse a missing word", () => {
    expect(fillTitle("Restart {language} server", { language: "Python" })).toBe(
      "Restart Python server"
    );
    expect(fillTitle("Trust {trustSubject}…", {})).toBeNull();
    expect(fillTitle("Format document", {})).toBe("Format document");
  });

  test("the language commands are gated on the focused file or the Workspace", () => {
    const language: ReadonlyArray<CommandId> = [
      "language.restart",
      "editor.format",
      "language.showLog",
      "typescript.selectVersion",
      "trust.grant",
      "trust.revoke",
      "trust.askAgain",
    ];

    for (const id of language) expect(bindingOf(id)?.when).toBeDefined();
    const open = bindingOf("palette.open");

    expect(open === undefined ? "missing" : paletteEntry(open)).toBeNull();
  });

  test("menus format F-keys, ⌫ and the edit chords like any other", () => {
    expect(formatChord(parseChord("F2"), "mac")).toBe("F2");
    expect(formatChord(parseChord("CmdOrCtrl+Backspace"), "mac")).toBe("⌘⌫");
    expect(Object.values(EDIT_CHORDS).map((k) => formatChord(parseChord(k), "mac"))).toEqual([
      "⌘X",
      "⌘C",
      "⌘V",
      "⌘A",
    ]);
  });
});
