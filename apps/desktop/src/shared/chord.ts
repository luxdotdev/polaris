/**
 * Accelerators ("CmdOrCtrl+Alt+Down") as chords a key event can match, and
 * as the UI shows them: glyphs on macOS ("⌥⌘↓"), words elsewhere ("Ctrl+Alt+Down").
 * Keys match by `event.code`, so ⌥ and keyboard layouts don't change which chord fires.
 */
import { clientPlatform } from "./platform.ts";

/** How keys behave and read: macOS, Windows, or Linux (every other OS). */
export type KeyPlatform = "mac" | "windows" | "linux";

/** A `process.platform` spelling ("darwin", "win32", …) as a key platform. */
export const keyPlatformOf = (platform: string): KeyPlatform => {
  if (platform === "darwin") return "mac";

  return platform === "win32" ? "windows" : "linux";
};

/** The platform this Client runs on, from the one shared source (`platform.ts`). */
export const currentKeyPlatform = (): KeyPlatform => keyPlatformOf(String(clientPlatform()));

export interface Chord {
  /** ⌘ on macOS, Ctrl elsewhere. */
  readonly mod: boolean;
  /** The Control key itself (⌃ on macOS). */
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly code: string;
}

const NAMED = new Map<string, string>([
  ["/", "Slash"],
  [".", "Period"],
  [",", "Comma"],
  ["`", "Backquote"],
  ["[", "BracketLeft"],
  ["]", "BracketRight"],
  ["Up", "ArrowUp"],
  ["Down", "ArrowDown"],
  ["Left", "ArrowLeft"],
  ["Right", "ArrowRight"],
  ["Enter", "Enter"],
  ["Return", "Enter"],
  ["Esc", "Escape"],
  ["Escape", "Escape"],
  ["Space", "Space"],
  ["Tab", "Tab"],
  ["Backspace", "Backspace"],
  ["Delete", "Delete"],
  ["PageUp", "PageUp"],
  ["PageDown", "PageDown"],
]);

const codeOf = (key: string): string => {
  const named = NAMED.get(key);

  if (named !== undefined) return named;

  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;

  if (/^\d$/.test(key)) return `Digit${key}`;

  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return key;

  throw new Error(`no key code for "${key}"`);
};

export const parseChord = (accelerator: string): Chord => {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const has = (...names: ReadonlyArray<string>) => parts.some((p) => names.includes(p));

  return {
    mod: has("CmdOrCtrl", "CommandOrControl", "Cmd", "Command"),
    ctrl: has("Ctrl", "Control"),
    alt: has("Alt", "Option"),
    shift: has("Shift"),
    // "Shift+/" is "?" typed without a modifier: key "" when the last part was empty ("+").
    code: codeOf(key === "" ? "+" : key),
  };
};

/** One canonical spelling per chord, for comparing tables. */
export const chordKey = (chord: Chord): string =>
  [chord.mod && "Mod", chord.ctrl && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", chord.code]
    .filter((p) => p !== false)
    .join("+");

/** No ⌘, ⌃ or ⌥: typing produces it, so it must not fire inside a text field. */
export const isBare = (chord: Chord) => !chord.mod && !chord.ctrl && !chord.alt;

export interface KeyEventLike {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Off macOS Control is the mod key, so "Ctrl+Tab" and "CmdOrCtrl+Tab" are one chord. */
export const onPlatform = (chord: Chord, platform: KeyPlatform): Chord =>
  platform === "mac" ? chord : { ...chord, mod: chord.mod || chord.ctrl, ctrl: false };

/** The canonical spelling of a chord as it is pressed on a platform. */
export const platformChordKey = (chord: Chord, platform: KeyPlatform): string =>
  chordKey(onPlatform(chord, platform));

export const matches = (
  chord: Chord,
  event: KeyEventLike,
  platform: KeyPlatform = currentKeyPlatform()
): boolean => {
  const mac = platform === "mac";
  const mod = mac ? event.metaKey : event.ctrlKey;
  const ctrl = mac ? event.ctrlKey : false;
  const pressed = onPlatform(chord, platform);

  return (
    event.code === pressed.code &&
    mod === pressed.mod &&
    ctrl === pressed.ctrl &&
    event.altKey === pressed.alt &&
    event.shiftKey === pressed.shift
  );
};

const GLYPHS = new Map<string, string>([
  ["ArrowUp", "↑"],
  ["ArrowDown", "↓"],
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["Enter", "↵"],
  ["Escape", "esc"],
  ["Slash", "/"],
  ["Period", "."],
  ["Comma", ","],
  ["Backquote", "`"],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Minus", "-"],
  ["Space", "Space"],
  ["Tab", "⇥"],
  ["Backspace", "⌫"],
  ["Delete", "⌦"],
]);

/** Windows and Linux spell keys out, as their guidelines do ("Ctrl+Shift+Up", "Esc"). */
const WORDS = new Map<string, string>([
  ["ArrowUp", "Up"],
  ["ArrowDown", "Down"],
  ["ArrowLeft", "Left"],
  ["ArrowRight", "Right"],
  ["Enter", "Enter"],
  ["Escape", "Esc"],
  ["Tab", "Tab"],
  ["Backspace", "Backspace"],
  ["Delete", "Delete"],
  ["PageUp", "PageUp"],
  ["PageDown", "PageDown"],
]);

const plainKey = (code: string) => code.replace(/^Key/, "").replace(/^Digit/, "");

const keyGlyph = (code: string) => GLYPHS.get(code) ?? plainKey(code);

const keyWord = (code: string) => WORDS.get(code) ?? keyGlyph(code);

/**
 * "⌥⌘↓", "⌘/", "?" on macOS (its order: ⌃⌥⇧⌘); "Ctrl+Alt+Down", "Ctrl+/", "?"
 * elsewhere (Ctrl, Alt, Shift, then the key).
 */
export const formatChord = (chord: Chord, platform: KeyPlatform = currentKeyPlatform()): string => {
  if (chord.shift && isBare(chord) && chord.code === "Slash") return "?";

  if (platform !== "mac") {
    const ctrl = chord.mod || chord.ctrl;

    return [ctrl && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", keyWord(chord.code)]
      .filter((p) => p !== false)
      .join("+");
  }

  return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${chord.mod ? "⌘" : ""}${keyGlyph(chord.code)}`;
};

/** An accelerator as a menu or hint shows it, or nothing when there is none. */
export const acceleratorLabel = (
  accelerator: string | undefined,
  platform: KeyPlatform = currentKeyPlatform()
): string | undefined =>
  accelerator === undefined ? undefined : formatChord(parseChord(accelerator), platform);

/** An accelerator's label for copy, where it is always present ("⌘↵", "Ctrl+Enter"). */
export const shortcutLabel = (
  accelerator: string,
  platform: KeyPlatform = currentKeyPlatform()
): string => formatChord(parseChord(accelerator), platform);

export type Modifier = "CmdOrCtrl" | "Ctrl" | "Alt" | "Shift";

const MAC_MODIFIERS: Record<Modifier, string> = {
  CmdOrCtrl: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

/** A modifier held on its own, as copy names it ("Hold ⌥", "Hold Alt"; "⌘-click", "Ctrl-click"). */
export const modifierLabel = (
  modifier: Modifier,
  platform: KeyPlatform = currentKeyPlatform()
): string => {
  if (platform === "mac") return MAC_MODIFIERS[modifier];

  return modifier === "CmdOrCtrl" ? "Ctrl" : modifier;
};

/** The mod key of a pointer or key event: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = (
  event: { readonly metaKey: boolean; readonly ctrlKey: boolean },
  platform: KeyPlatform = currentKeyPlatform()
): boolean => (platform === "mac" ? event.metaKey : event.ctrlKey);
