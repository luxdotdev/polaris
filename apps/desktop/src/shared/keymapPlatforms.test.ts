import { describe, expect, test } from "bun:test";
import {
  acceleratorLabel,
  formatChord,
  type KeyPlatform,
  keyPlatformOf,
  matches,
  modifierLabel,
  modKey,
  parseChord,
  platformChordKey,
} from "./chord.ts";
import {
  chordOf,
  type CommandId,
  commandShortcut,
  digitChord,
  digitModifiersFor,
  keymapFor,
  reservedFor,
  TERMINAL_TOGGLE,
  WINDOWS_KEYS,
} from "./keymap.ts";
import { setClientPlatform } from "./platform.ts";

const PLATFORMS: ReadonlyArray<KeyPlatform> = ["mac", "windows", "linux"];

const key = (accelerator: string, platform: KeyPlatform) =>
  platformChordKey(parseChord(accelerator), platform);

const chordsOn = (platform: KeyPlatform) =>
  keymapFor(platform).flatMap((b) => b.keys.map((k) => ({ id: b.id, key: key(k, platform) })));

const press = (
  code: string,
  mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>>
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe("labels per platform", () => {
  test("Windows and Linux spell chords out; macOS keeps its glyphs", () => {
    const accelerators = ["CmdOrCtrl+Shift+P", "CmdOrCtrl+Alt+Down", "F12", "Shift+/", "Ctrl+`"];

    expect(accelerators.map((a) => acceleratorLabel(a, "mac"))).toEqual([
      "⇧⌘P",
      "⌥⌘↓",
      "F12",
      "?",
      "⌃`",
    ]);

    for (const platform of ["windows", "linux"] as const)
      expect(accelerators.map((a) => acceleratorLabel(a, platform))).toEqual([
        "Ctrl+Shift+P",
        "Ctrl+Alt+Down",
        "F12",
        "?",
        "Ctrl+`",
      ]);
  });

  test("named keys read as words off macOS", () => {
    expect(
      [
        "CmdOrCtrl+Enter",
        "Shift+Enter",
        "Esc",
        "Ctrl+Tab",
        "CmdOrCtrl+PageDown",
        "Shift+Alt+F",
      ].map((a) => formatChord(parseChord(a), "windows"))
    ).toEqual(["Ctrl+Enter", "Shift+Enter", "Esc", "Ctrl+Tab", "Ctrl+PageDown", "Alt+Shift+F"]);
  });

  test("held modifiers and the mod key", () => {
    expect(modifierLabel("Alt", "mac")).toBe("⌥");
    expect(modifierLabel("Alt", "windows")).toBe("Alt");
    expect(modifierLabel("CmdOrCtrl", "windows")).toBe("Ctrl");
    expect(modKey({ metaKey: true, ctrlKey: false }, "mac")).toBe(true);
    expect(modKey({ metaKey: true, ctrlKey: false }, "windows")).toBe(false);
    expect(modKey({ metaKey: false, ctrlKey: true }, "windows")).toBe(true);
  });

  test("the default platform comes from clientPlatform()", () => {
    setClientPlatform("win32");

    try {
      expect(commandShortcut("palette.open")).toBe("Ctrl+Shift+P");
      expect(commandShortcut("view.output")).toBe("Ctrl+Shift+B");
    } finally {
      setClientPlatform(null);
    }

    expect(keyPlatformOf("freebsd")).toBe("linux");
  });
});

describe("Windows keys", () => {
  test("Control is the mod key, so Ctrl+Tab fires", () => {
    const tab = parseChord("Ctrl+Tab");

    expect(matches(tab, press("Tab", { ctrl: true }), "windows")).toBe(true);
    expect(matches(parseChord("CmdOrCtrl+S"), press("KeyS", { ctrl: true }), "windows")).toBe(true);
    expect(matches(parseChord("CmdOrCtrl+S"), press("KeyS", { meta: true }), "windows")).toBe(
      false
    );
  });

  test("no binding uses Ctrl+Alt, which is AltGr on European layouts", () => {
    const altGr = chordsOn("windows").filter((c) => /Mod\+Alt\b/.test(c.key));

    expect(altGr).toEqual([]);
  });

  test("the overrides are the approved table", () => {
    // SAFETY: WINDOWS_KEYS is typed by CommandId, so its own keys are command ids.
    const ids = Object.keys(WINDOWS_KEYS) as Array<CommandId>;

    const shown = Object.fromEntries(
      ids.map((id) => [id, acceleratorLabel(chordOf(id, "windows"), "windows") ?? ""])
    );

    expect(shown).toEqual({
      "language.restart": "Ctrl+Shift+R",
      "view.output": "Ctrl+Shift+B",
      "session.next": "Ctrl+PageDown",
      "session.previous": "Ctrl+PageUp",
      "tab.closeOthers": "",
    });
  });

  test("macOS and Linux keep their keys", () => {
    expect(keymapFor("linux")).toBe(keymapFor("mac"));
    expect(chordOf("view.output", "mac")).toBe("CmdOrCtrl+Alt+B");
  });

  test("Workspace chips are Alt+1…0 only; Ctrl+1–3 stay the views", () => {
    expect(digitModifiersFor("windows")).toEqual(["Alt"]);
    expect([0, 9, 10].map((i) => digitChord(i, "windows"))).toEqual(["Alt+1", "Alt+0", undefined]);
    expect(chordOf("view.orchestrate", "windows")).toBe("CmdOrCtrl+1");
  });
});

const noConflicts = (platform: KeyPlatform) => {
  const chords = chordsOn(platform);

  test("no two commands share a chord unless one declares it", () => {
    const seen = new Map<string, CommandId>();
    const bindings = keymapFor(platform);

    const declared = (a: CommandId, b: CommandId) =>
      bindings.find((x) => x.id === a)?.shares === b ||
      bindings.find((x) => x.id === b)?.shares === a;

    for (const { id, key: k } of chords) {
      const other = seen.get(k);

      if (other !== undefined && other !== id)
        expect(`${id} ${other} ${declared(id, other)}`).toBe(`${id} ${other} true`);

      seen.set(k, id);
    }
  });

  test("nothing takes a reserved chord, the digit chips or the terminal toggle", () => {
    const reserved = reservedFor(platform).map((r) => key(r, platform));

    const digits = digitModifiersFor(platform).flatMap((m) =>
      Array.from({ length: 10 }, (_, d) => key(`${m}+${d}`, platform))
    );

    const taken = new Set([...reserved, ...digits, key(TERMINAL_TOGGLE, platform)]);

    expect(chords.filter((c) => taken.has(c.key))).toEqual([]);
  });

  test("the terminal toggle is not reserved", () => {
    const toggle = key(TERMINAL_TOGGLE, platform);

    expect(reservedFor(platform).map((r) => key(r, platform))).not.toContain(toggle);
  });
};

for (const platform of PLATFORMS)
  describe(`no conflicts on ${platform}`, () => noConflicts(platform));
