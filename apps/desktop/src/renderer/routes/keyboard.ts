/**
 * The shell's keys: the command registry's shortcuts (`shared/keymap.ts`),
 * plus ⌃1…⌃0 (or ⌥1…⌥0, since macOS may bind ⌃N to Spaces), which pick a
 * Workspace chip or a machine and depend on the data.
 */
import type { CommandRegistry, KeyInput } from "./commands.ts";
import type { ShellActions } from "./navigation.ts";

/** "Digit1" … "Digit9" → 0 … 8, "Digit0" → 9 (the tenth chip); layout-independent. */
export const digitIndex = (code: string): number | null => {
  const match = /^Digit(\d)$/.exec(code);

  if (match === null) return null;
  const digit = Number(match[1]);

  return digit === 0 ? 9 : digit - 1;
};

/** Typing in a field must never trigger a bare-key shortcut. */
export const isTyping = (target: EventTarget | null) =>
  "HTMLElement" in globalThis &&
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export interface KeyContext {
  readonly actions: ShellActions;
  readonly registry: CommandRegistry;
}

/** Runs the shortcut for a key event; true when it handled it. */
export const handleKey = (
  event: KeyInput & { readonly timeStamp: number },
  { actions, registry }: KeyContext
): boolean => {
  const digit = digitIndex(event.code);

  if (digit !== null && (event.ctrlKey || event.altKey) && !event.metaKey && !event.shiftKey) {
    actions.selectShortcut(digit, event.timeStamp);

    return true;
  }

  return registry.handleKey(event);
};

export const installKeyboard = (context: KeyContext) => {
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;

    const input = {
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      timeStamp: event.timeStamp,
      typing: isTyping(event.target),
    };

    if (handleKey(input, context)) event.preventDefault();
  };

  window.addEventListener("keydown", listener);

  return () => window.removeEventListener("keydown", listener);
};
