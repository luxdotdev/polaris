/** The Client Setting accepts one accelerator per action, or null to unbind it. */
import { Schema } from "effect";
import {
  currentKeyPlatform,
  parseChord,
  platformChordKey,
  type KeyEventLike,
  type KeyPlatform,
} from "./chord.ts";
import { KEYMAP, reservedFor, digitModifiersFor } from "./keymap.ts";

const MODIFIERS = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];

const KEY =
  /^(?:[A-Z0-9/.,`[\];'=\\-]|Up|Down|Left|Right|Enter|Escape|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-2]))$/;

export const bindingSyntaxError = (value: string): string | null => {
  const parts = value.split("+");
  const key = parts.pop() ?? "";

  if (
    !KEY.test(key) ||
    parts.some((p) => !MODIFIERS.includes(p)) ||
    new Set(parts).size !== parts.length
  )
    return "Use one key with CmdOrCtrl, Ctrl, Alt or Shift, such as CmdOrCtrl+Shift+P.";

  return null;
};

/** Reject shortcuts intercepted outside the command dispatcher, including native menu roles. */
export const bindingUnavailable = (
  value: string,
  platform: KeyPlatform = currentKeyPlatform()
): string | null => {
  const syntax = bindingSyntaxError(value);

  if (syntax !== null) return syntax;
  const chord = platformChordKey(parseChord(value), platform);

  const digits = digitModifiersFor(platform).flatMap((m) =>
    Array.from({ length: 10 }, (_, n) => `${m}+${n}`)
  );

  const reserved = [...reservedFor(platform), ...digits, "Ctrl+`", "Escape"];

  return reserved.some((key) => platformChordKey(parseChord(key), platform) === chord)
    ? "This shortcut is reserved by the system or a built-in control."
    : null;
};

export const KeybindingOverrides = Schema.Record(Schema.String, Schema.NullOr(Schema.String))
  .check(
    Schema.makeFilter((value) => {
      for (const [id, key] of Object.entries(value)) {
        if (!KEYMAP.some((b) => b.id === id)) return `Unknown action: ${id}`;

        if (key !== null) {
          const error = bindingUnavailable(key);

          if (error !== null) return `${id}: ${error}`;
        }
      }

      return true;
    })
  )
  .annotate({
    description:
      "Keyboard overrides by action id. Each value is one accelerator (for example CmdOrCtrl+Shift+P), or null to unbind. Omit an action to restore defaults; {} resets all. No sequences or contexts. A user override wins over defaults; for duplicate overrides the last entry wins. Conflicts are shown in Settings → Keyboard.",
  });

export type KeybindingOverrides = typeof KeybindingOverrides.Type;

const CODE_KEYS = new Map(
  Object.entries({
    Slash: "/",
    Period: ".",
    Comma: ",",
    Backquote: "`",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Semicolon: ";",
    Quote: "'",
    Backslash: "\\",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  })
);

export const recordedBinding = (
  event: KeyEventLike,
  platform: KeyPlatform = currentKeyPlatform()
): string | null => {
  if (platform !== "mac" && event.metaKey) return null;
  const key = CODE_KEYS.get(event.code) ?? event.code.replace(/^Key|^Digit/, "");

  if (!KEY.test(key)) return null;
  const mod = platform === "mac" ? event.metaKey : event.ctrlKey;

  const parts = [
    mod && "CmdOrCtrl",
    platform === "mac" && event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ];

  return parts.filter(Boolean).join("+");
};
