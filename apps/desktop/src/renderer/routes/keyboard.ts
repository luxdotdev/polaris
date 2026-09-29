/**
 * The shell's keys. ⌘1–3 come from the native menu (main/menu.ts); these are
 * the ones that depend on data: ⌃1…⌃0 (or ⌥1…⌥0, since macOS may bind ⌃N to
 * Spaces) pick a Workspace chip or a machine, K and ⌘K open the jump menu, ⌘N a new session.
 */
import type { ShellActions } from "./navigation.ts";

/** "Digit1" … "Digit9" → 0 … 8, "Digit0" → 9 (the tenth chip); layout-independent. */
export const digitIndex = (code: string): number | null => {
  const match = /^Digit(\d)$/.exec(code);

  if (match === null) return null;
  const digit = Number(match[1]);

  return digit === 0 ? 9 : digit - 1;
};

/** Typing in a field must never trigger a bare-key shortcut. */
const typing = (target: EventTarget | null) =>
  "HTMLElement" in globalThis &&
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly timeStamp: number;
  readonly target: EventTarget | null;
}

/** Runs the shortcut for a key event; true when it handled it. */
export const handleKey = (event: KeyInput, actions: ShellActions): boolean => {
  const digit = digitIndex(event.code);

  if (digit !== null && (event.ctrlKey || event.altKey) && !event.metaKey && !event.shiftKey) {
    actions.selectShortcut(digit, event.timeStamp);

    return true;
  }

  const k = event.key.toLowerCase() === "k" && !event.ctrlKey && !event.altKey && !event.shiftKey;

  if (k && (event.metaKey || !typing(event.target))) {
    actions.openJump();

    return true;
  }

  if (event.key.toLowerCase() === "n" && event.metaKey && !event.shiftKey && !event.altKey) {
    actions.startNewSession();

    return true;
  }

  return false;
};

export const installKeyboard = (actions: ShellActions) => {
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;

    if (handleKey(event, actions)) event.preventDefault();
  };

  window.addEventListener("keydown", listener);

  return () => window.removeEventListener("keydown", listener);
};
