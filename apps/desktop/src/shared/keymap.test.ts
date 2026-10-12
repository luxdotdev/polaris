import { describe, expect, test } from "bun:test";
import { chordKey, formatChord, isBare, parseChord } from "./chord.ts";
import {
  bindingOf,
  type CommandId,
  EDIT_CHORDS,
  fillTitle,
  holds,
  KEYMAP,
  paletteEntry,
  RESERVED,
  SHORTCUT_DIGIT_MODIFIERS,
} from "./keymap.ts";

const chords = KEYMAP.flatMap((b) =>
  b.keys.map((k) => ({ id: b.id, key: chordKey(parseChord(k)) }))
);

describe("keymap", () => {
  test("no two commands share a chord unless one declares it", () => {
    const seen = new Map<string, CommandId>();

    const declared = (a: CommandId, b: CommandId) =>
      bindingOf(a)?.shares === b || bindingOf(b)?.shares === a;

    for (const { id, key } of chords) {
      const other = seen.get(key);

      if (other !== undefined && other !== id)
        expect(`${id} ${other} ${declared(id, other)}`).toBe(`${id} ${other} true`);
      seen.set(key, id);
    }
  });

  test("nothing takes a chord macOS, Electron or the standard menus own", () => {
    const reserved = new Set(RESERVED.map((r) => chordKey(parseChord(r))));

    expect(chords.filter((c) => reserved.has(c.key))).toEqual([]);
  });

  test("nothing collides with ⌃1…⌃0 / ⌥1…⌥0 (Workspace chips)", () => {
    const digits = SHORTCUT_DIGIT_MODIFIERS.flatMap((m) =>
      Array.from({ length: 10 }, (_, d) => chordKey(parseChord(`${m}+${d}`)))
    );

    expect(chords.filter((c) => digits.includes(c.key))).toEqual([]);
  });

  test("every menu item a user can press shows a chord with a modifier", () => {
    for (const b of KEYMAP.filter((b) => b.menu !== undefined && b.keys.length > 0)) {
      expect(isBare(parseChord(b.keys[0] ?? ""))).toBe(false);
    }
  });

  test("chords format the macOS way", () => {
    expect(
      ["CmdOrCtrl+Alt+Down", "CmdOrCtrl+Shift+A", "Shift+/", "CmdOrCtrl+."].map((k) =>
        formatChord(parseChord(k))
      )
    ).toEqual(["⌥⌘↓", "⇧⌘A", "?", "⌘."]);
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

  test("follow-up commands say so with …, and only they do", () => {
    for (const b of KEYMAP) {
      const entry = paletteEntry(b);

      if (entry === null) continue;
      const title = entry.title ?? b.title;

      if (entry.followUp) expect(title.endsWith("…")).toBe(true);
    }
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
    expect(bindingOf("language.restart")?.keys[0]).toBe("CmdOrCtrl+Alt+R");
    expect(bindingOf("palette.open")?.keys[0]).toBe("CmdOrCtrl+Shift+P");
    const open = bindingOf("palette.open");

    expect(open === undefined ? "missing" : paletteEntry(open)).toBeNull();
  });

  test("menus format F-keys, ⌫ and the edit chords like any other", () => {
    expect(formatChord(parseChord("F2"))).toBe("F2");
    expect(formatChord(parseChord("CmdOrCtrl+Backspace"))).toBe("⌘⌫");
    expect(Object.values(EDIT_CHORDS).map((k) => formatChord(parseChord(k)))).toEqual([
      "⌘X",
      "⌘C",
      "⌘V",
      "⌘A",
    ]);
  });
});
