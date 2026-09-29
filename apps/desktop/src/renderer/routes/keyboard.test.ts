import { describe, expect, test } from "bun:test";
import { digitIndex, handleKey, type KeyInput } from "./keyboard.ts";
import type { ShellActions } from "./navigation.ts";

const recorder = () => {
  const calls: Array<string> = [];

  const record = (name: string) => () => {
    calls.push(`${name}()`);
  };

  const actions: ShellActions = {
    setMode: record("setMode"),
    selectSession: record("selectSession"),
    selectWorkspace: record("selectWorkspace"),
    selectHost: record("selectHost"),
    selectShortcut: (index) => calls.push(`selectShortcut(${index})`),
    showSidebar: record("showSidebar"),
    openJump: record("openJump"),
    setJumpOpen: record("setJumpOpen"),
    startNewSession: record("startNewSession"),
    closeNewSession: record("closeNewSession"),
    toggleFolded: record("toggleFolded"),
  };

  return { calls, actions };
};

const key = (patch: Partial<KeyInput>): KeyInput => ({
  key: "",
  code: "",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  timeStamp: 0,
  target: null,
  ...patch,
});

describe("keyboard", () => {
  test("digits map to chip indexes, 0 is the tenth", () => {
    expect(["Digit1", "Digit9", "Digit0", "KeyA"].map(digitIndex)).toEqual([0, 8, 9, null]);
  });

  test("⌃N and ⌥N pick a chip; ⌘N and ⇧⌃N don't", () => {
    const { calls, actions } = recorder();

    handleKey(key({ code: "Digit2", key: "2", ctrlKey: true }), actions);
    handleKey(key({ code: "Digit0", key: "º", altKey: true }), actions);
    handleKey(key({ code: "Digit3", key: "3", ctrlKey: true, shiftKey: true }), actions);
    expect(calls).toEqual(["selectShortcut(1)", "selectShortcut(9)"]);
  });

  test("K and ⌘K open the jump menu, ⌘N a new session", () => {
    const { calls, actions } = recorder();

    handleKey(key({ key: "k" }), actions);
    handleKey(key({ key: "k", metaKey: true }), actions);
    handleKey(key({ key: "n", metaKey: true }), actions);
    expect(calls).toEqual(["openJump()", "openJump()", "startNewSession()"]);
  });
});
