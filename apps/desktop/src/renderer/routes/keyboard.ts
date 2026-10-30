/**
 * The shell's keys: the command registry's shortcuts (`shared/keymap.ts`),
 * plus ⌃1…⌃0 (or ⌥1…⌥0, since macOS may bind ⌃N to Spaces), which pick a
 * Workspace chip or a machine and depend on the data (in Review, ⌃1…⌃9 pick a review).
 */
import { currentKeyPlatform, type KeyPlatform } from "../../shared/chord.ts";
import { type CommandId, digitModifiersFor } from "../../shared/keymap.ts";
import type { CommandRegistry, KeyInput } from "./commands.ts";
import type { ShellActions } from "./navigation.ts";
import { reviewDigits } from "./review.ts";

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

const holds = (event: KeyInput, modifier: "Ctrl" | "Alt") =>
  modifier === "Ctrl" ? event.ctrlKey : event.altKey;

/** Runs the shortcut for a key event; true when it handled it. */
export const handleKey = (
  event: KeyInput & { readonly timeStamp: number },
  { actions, registry }: KeyContext,
  platform: KeyPlatform = currentKeyPlatform()
): boolean => {
  const digit = digitIndex(event.code);
  const modifiers = digitModifiersFor(platform);
  const [first = "Ctrl"] = modifiers;
  const other = first === "Ctrl" ? "Alt" : "Ctrl";
  const plain = !event.metaKey && !event.shiftKey;
  const firstOnly = plain && holds(event, first) && !holds(event, other);

  // In Review, ⌃N (Ctrl+N elsewhere) opens the queue's Nth review; Orchestrate keeps its chips.
  if (digit !== null && firstOnly && reviewDigits.pick?.(digit) === true) return true;

  // Off macOS Ctrl+Alt is AltGr (it types { on German), so only Ctrl alone picks a chip.
  const chip = platform === "mac" ? plain && modifiers.some((m) => holds(event, m)) : firstOnly;

  if (digit !== null && chip) {
    actions.selectShortcut(digit, event.timeStamp);

    return true;
  }

  return registry.handleKey(event);
};

/**
 * Escape closes the shell's own overlay, decided from state and before any Radix
 * layer sees the key: Radix's layer stack is stale while one dialog closes and the next opens.
 */
export const handleOverlayEscape = (
  event: { readonly key: string; readonly isComposing: boolean },
  actions: ShellActions
): boolean => !event.isComposing && event.key === "Escape" && actions.closeOverlay();

export const installKeyboard = (context: KeyContext) => {
  const escape = (event: KeyboardEvent) => {
    if (!handleOverlayEscape(event, context.actions)) return;
    event.preventDefault();
    event.stopPropagation();
  };

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

  window.addEventListener("keydown", escape, { capture: true });
  window.addEventListener("keydown", listener);

  return () => {
    window.removeEventListener("keydown", escape, { capture: true });
    window.removeEventListener("keydown", listener);
  };
};

/** The mouse's back and forward buttons (`MouseEvent.button` 3 and 4). */
const MOUSE_COMMANDS: ReadonlyMap<number, CommandId> = new Map([
  [3, "navigation.back"],
  [4, "navigation.forward"],
]);

/** Runs Back and Forward from the mouse's side buttons, and keeps Chromium from acting on them. */
export const installMouseButtons = (registry: CommandRegistry) => {
  const swallow = (event: MouseEvent) => {
    if (MOUSE_COMMANDS.has(event.button)) event.preventDefault();
  };

  const listener = (event: MouseEvent) => {
    const id = MOUSE_COMMANDS.get(event.button);

    if (id === undefined) return;
    event.preventDefault();
    registry.run(id);
  };

  window.addEventListener("mousedown", swallow);
  window.addEventListener("mouseup", listener);

  return () => {
    window.removeEventListener("mousedown", swallow);
    window.removeEventListener("mouseup", listener);
  };
};
