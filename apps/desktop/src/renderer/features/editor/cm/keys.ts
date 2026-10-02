/**
 * Polaris shortcuts keep working inside the editor (spec §4): any CodeMirror
 * binding on a chord the shell owns is dropped, so the key reaches the
 * window's keyboard handler. ⌘/ stays the editor's: it toggles a comment.
 */
import type { KeyBinding as CmBinding } from "@codemirror/view";
import { chordKey, isBare, parseChord } from "../../../../shared/chord.ts";
import { KEYMAP } from "../../../../shared/keymap.ts";

/** Chords the editor keeps although the shell binds them too. */
const EDITOR_OWNS = new Set(["Mod+Slash"]);

/** ⌘I, ⌘L, ⌘P belong to the inline chat, ⌘L's picker and the finder; ⌘S to saving. */
const RESERVED_ALWAYS = ["CmdOrCtrl+I", "CmdOrCtrl+L", "CmdOrCtrl+P", "CmdOrCtrl+S"];

const CM_KEYS = new Map<string, string>([
  ["/", "Slash"],
  [".", "Period"],
  [",", "Comma"],
  ["`", "Backquote"],
  ["[", "BracketLeft"],
  ["]", "BracketRight"],
  ["\\", "Backslash"],
  [";", "Semicolon"],
  ["'", "Quote"],
  ["=", "Equal"],
  ["-", "Minus"],
  [" ", "Space"],
  ["Space", "Space"],
]);

const codeOfCmKey = (key: string): string => {
  const named = CM_KEYS.get(key);

  if (named !== undefined) return named;

  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`;

  return /^\d$/.test(key) ? `Digit${key}` : key;
};

/** A CodeMirror key name ("Mod-Alt-ArrowUp") as the shell's canonical chord. */
export const cmChord = (name: string, mac: boolean): string => {
  // "Mod--" ends in the minus key itself.
  const parts = name.endsWith("--") ? [...name.slice(0, -2).split("-"), "-"] : name.split("-");
  const key = parts.pop() ?? "";
  const has = (...names: ReadonlyArray<string>) => parts.some((p) => names.includes(p));
  const mod = has("Mod") || (mac ? has("Cmd", "Meta") : has("Ctrl"));
  const ctrl = mac && has("Ctrl");

  return chordKey({
    mod,
    ctrl,
    alt: has("Alt"),
    shift: has("Shift"),
    code: codeOfCmKey(key),
  });
};

const digitChords = ["Ctrl", "Alt"].flatMap((m) =>
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => `${m}+Digit${d}`)
);

/** Every chord the shell (or a sibling feature) owns, minus the editor's own. */
export const shellChords = (): ReadonlySet<string> => {
  const keys = [...KEYMAP.flatMap((b) => b.keys), ...RESERVED_ALWAYS];

  const chords = keys.flatMap((key) => {
    const chord = parseChord(key);

    return isBare(chord) ? [] : [chordKey(chord)];
  });

  return new Set([...chords, ...digitChords].filter((c) => !EDITOR_OWNS.has(c)));
};

const bindingKeys = (binding: CmBinding, mac: boolean) =>
  [mac ? (binding.mac ?? binding.key) : binding.key].filter((k): k is string => k !== undefined);

/** The bindings with every shell chord taken out. */
export const shellSafe = (
  bindings: ReadonlyArray<CmBinding>,
  mac: boolean,
  reserved: ReadonlySet<string> = shellChords()
): ReadonlyArray<CmBinding> =>
  bindings.filter((b) => !bindingKeys(b, mac).some((k) => reserved.has(cmChord(k, mac))));

/** A key event as the shell's canonical chord. */
export const eventChord = (event: KeyboardEvent, mac: boolean): string =>
  chordKey({
    mod: mac ? event.metaKey : event.ctrlKey,
    ctrl: mac && event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    code: event.code,
  });

const pick = (e: KeyboardEvent): KeyboardEventInit => ({
  key: e.key,
  code: e.code,
  metaKey: e.metaKey,
  ctrlKey: e.ctrlKey,
  altKey: e.altKey,
  shiftKey: e.shiftKey,
  repeat: e.repeat,
});

/**
 * Vim swallows keys before CodeMirror's keymaps, so shell chords are caught on
 * the way down and sent to the window's keyboard handler instead.
 */
export const forwardShellChords = (root: HTMLElement, mac: boolean): (() => void) => {
  const reserved = shellChords();

  const capture = (event: KeyboardEvent) => {
    if (event.isComposing || !reserved.has(eventChord(event, mac))) return;
    event.stopPropagation();

    const forwarded = new KeyboardEvent("keydown", {
      ...pick(event),
      bubbles: true,
      cancelable: true,
    });

    if (!window.dispatchEvent(forwarded)) event.preventDefault();
  };

  root.addEventListener("keydown", capture, { capture: true });

  return () => root.removeEventListener("keydown", capture, { capture: true });
};
