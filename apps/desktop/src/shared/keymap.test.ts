import { describe, expect, test } from "bun:test";
import { chordKey, formatChord, isBare, parseChord } from "./chord.ts";
import { bindingOf, type CommandId, KEYMAP, RESERVED, SHORTCUT_DIGIT_MODIFIERS } from "./keymap.ts";

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
