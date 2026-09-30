/**
 * The sign-in hand-off's minimal terminal: a Harness's own sign-in runs in a
 * Polaris terminal on the Host. Output becomes plain text (escape sequences
 * dropped, carriage returns honoured); keys become the bytes a TTY expects.
 */

const ESC = "\\u001B";

const BEL = "\\u0007";

const ESCAPES = [
  // OSC … BEL / ST (titles, hyperlinks)
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g"),
  // CSI … final byte (colours, cursor moves, clears)
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g"),
  // Two-byte escapes (charset, keypad modes)
  new RegExp(`${ESC}[()#][0-9A-Za-z]|${ESC}[=>78cDEHMNOZ]`, "g"),
];

const stripEscapes = (text: string) => ESCAPES.reduce((t, re) => t.replace(re, ""), text);

/** A line with its carriage returns applied: text after the last `\r` overwrites from column 0. */
const settleLine = (line: string): string => {
  const parts = line.split("\r");

  return parts.reduce((shown, part) => part + shown.slice(part.length), "");
};

/** Text a reader sees: newlines, tabs and everything from space up, but not DEL. */
const printable = (c: string) => {
  const code = c.codePointAt(0) ?? 0;

  return c === "\n" || c === "\t" || (code >= 0x20 && code !== 0x7f);
};

/** Appends a chunk of terminal output to the text so far, as a person would read it. */
export const appendOutput = (shown: string, chunk: string): string => {
  const raw = (shown + stripEscapes(chunk)).replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const settled = lines.map((line, i) => (i === lines.length - 1 ? line : settleLine(line)));

  return Array.from(settled.join("\n")).filter(printable).join("");
};

/** Keeps the last `max` characters, so a chatty sign-in can't grow without bound. */
export const tail = (text: string, max = 20_000) =>
  text.length > max ? text.slice(text.length - max) : text;

const KEYS = new Map([
  ["Enter", "\r"],
  ["Backspace", "\u007F"],
  ["Tab", "\t"],
  ["Escape", "\u001B"],
  ["ArrowUp", "\u001B[A"],
  ["ArrowDown", "\u001B[B"],
  ["ArrowRight", "\u001B[C"],
  ["ArrowLeft", "\u001B[D"],
]);

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** The bytes a key sends, or null for keys the terminal leaves to the app (⌘-shortcuts). */
export const keyBytes = ({ key, ctrlKey, metaKey, altKey }: KeyInput): string | null => {
  if (metaKey) return null;

  if (ctrlKey && key.length === 1 && /[a-z]/i.test(key))
    return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);

  const named = KEYS.get(key);

  if (named !== undefined) return named;

  if (key.length !== 1) return null;

  return altKey ? `\u001B${key}` : key;
};

/** http(s) links in the output, so a printed sign-in URL can be opened. */
export const linksIn = (text: string): ReadonlyArray<string> => [
  ...new Set(text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []),
];
