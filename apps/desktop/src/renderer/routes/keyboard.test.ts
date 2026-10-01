import { describe, expect, test } from "bun:test";
import type { CommandId } from "../../shared/keymap.ts";
import { createCommandRegistry } from "./commands.ts";
import { digitIndex, handleKey } from "./keyboard.ts";
import type { ShellActions } from "./navigation.ts";
import { reviewDigits } from "./review.ts";

const setup = () => {
  const calls: Array<string> = [];
  const noop = () => undefined;

  const actions: ShellActions = {
    setMode: noop,
    selectSession: noop,
    selectWorkspace: noop,
    selectHost: noop,
    selectShortcut: (index) => void calls.push(`chip ${index}`),
    showSidebar: noop,
    openJump: noop,
    setJumpOpen: noop,
    setHelpOpen: noop,
    closeOverlay: () => false,
    startNewSession: noop,
    closeNewSession: noop,
    toggleFolded: noop,
    openSettings: noop,
    closeSettings: noop,
    openFolder: noop,
    closeFolder: noop,
    startNewSessionIn: noop,
  };

  const registry = createCommandRegistry({ mac: true });

  const ids: ReadonlyArray<CommandId> = [
    "jump.open",
    "session.new",
    "help.shortcuts",
    "session.next",
  ];

  registry.register(Object.fromEntries(ids.map((id) => [id, { run: () => void calls.push(id) }])));

  return { calls, context: { actions, registry } };
};

const key = (
  code: string,
  mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>> = {},
  typing = false
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  timeStamp: 0,
  typing,
});

describe("keyboard", () => {
  test("digits map to chip indexes, 0 is the tenth", () => {
    expect(["Digit1", "Digit9", "Digit0", "KeyA"].map(digitIndex)).toEqual([0, 8, 9, null]);
  });

  test("⌃N and ⌥N pick a chip; ⇧⌃N doesn't", () => {
    const { calls, context } = setup();

    handleKey(key("Digit2", { ctrl: true }), context);
    handleKey(key("Digit0", { alt: true }), context);
    handleKey(key("Digit3", { ctrl: true, shift: true }), context);
    expect(calls).toEqual(["chip 1", "chip 9"]);
  });

  test("in Review, ⌃N opens the queue's Nth review; ⌥N and an empty slot still pick a chip", () => {
    const { calls, context } = setup();

    reviewDigits.pick = (index) => index < 3 && calls.push(`review ${index}`) > 0;
    handleKey(key("Digit2", { ctrl: true }), context);
    handleKey(key("Digit2", { alt: true }), context);
    handleKey(key("Digit9", { ctrl: true }), context);
    reviewDigits.pick = null;
    expect(calls).toEqual(["review 1", "chip 1", "chip 8"]);
  });

  test("⇧⌘] and ⇧⌘[ cycle the review tabs", () => {
    const { calls, context } = setup();

    context.registry.register({
      "review.nextTab": { run: () => void calls.push("next") },
      "review.previousTab": { run: () => void calls.push("previous") },
    });
    handleKey(key("BracketRight", { meta: true, shift: true }), context);
    handleKey(key("BracketLeft", { meta: true, shift: true }), context);
    expect(calls).toEqual(["next", "previous"]);
  });

  test("K and ⌘K open the jump menu; bare K never fires while typing, ⌘K does", () => {
    const { calls, context } = setup();

    handleKey(key("KeyK"), context);
    handleKey(key("KeyK", {}, true), context);
    handleKey(key("KeyK", { meta: true }, true), context);
    expect(calls).toEqual(["jump.open", "jump.open"]);
  });

  test("⌘N, ⌘/ and ?, and ⌘⌥↓ run their commands", () => {
    const { calls, context } = setup();

    handleKey(key("KeyN", { meta: true }), context);
    handleKey(key("Slash", { meta: true }), context);
    handleKey(key("Slash", { shift: true }), context);
    handleKey(key("ArrowDown", { meta: true, alt: true }), context);
    expect(calls).toEqual(["session.new", "help.shortcuts", "help.shortcuts", "session.next"]);
  });

  test("a disabled command lets the key through", () => {
    const { context } = setup();

    context.registry.register({ "session.new": { run: () => undefined, enabled: () => false } });
    expect(handleKey(key("KeyN", { meta: true }), context)).toBe(false);
  });
});
