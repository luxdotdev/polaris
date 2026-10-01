/**
 * Accelerators ("CmdOrCtrl+Alt+Down") as chords a key event can match, and
 * as the glyphs the UI shows ("⌘⌥↓"). Keys match by `event.code`, so ⌥ and
 * keyboard layouts don't change which chord fires.
 */

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
]);

const codeOf = (key: string): string => {
  const named = NAMED.get(key);

  if (named !== undefined) return named;

  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;

  if (/^\d$/.test(key)) return `Digit${key}`;

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

export const matches = (chord: Chord, event: KeyEventLike, mac: boolean): boolean => {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const ctrl = mac ? event.ctrlKey : false;

  return (
    event.code === chord.code &&
    mod === chord.mod &&
    ctrl === chord.ctrl &&
    event.altKey === chord.alt &&
    event.shiftKey === chord.shift
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
  ["Space", "Space"],
  ["Tab", "⇥"],
]);

const keyGlyph = (code: string) =>
  GLYPHS.get(code) ?? code.replace(/^Key/, "").replace(/^Digit/, "");

/** "⌘⌥↓", "⌘/", "?" (macOS order: ⌃⌥⇧⌘). */
export const formatChord = (chord: Chord): string => {
  if (chord.shift && isBare(chord) && chord.code === "Slash") return "?";

  return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${chord.mod ? "⌘" : ""}${keyGlyph(chord.code)}`;
};
