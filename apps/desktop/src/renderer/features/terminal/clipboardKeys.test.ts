import { describe, expect, test } from "bun:test";
import { clipboardKey, type KeyLike } from "./clipboardKeys.ts";

const press = (key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("clipboardKey", () => {
  test("Windows copies with Ctrl+Shift+C and Ctrl+Insert", () => {
    expect(clipboardKey(press("C", { ctrlKey: true, shiftKey: true }), "win32")).toBe("copy");
    expect(clipboardKey(press("Insert", { ctrlKey: true }), "win32")).toBe("copy");
  });

  test("Windows pastes with Ctrl+Shift+V and Shift+Insert", () => {
    expect(clipboardKey(press("V", { ctrlKey: true, shiftKey: true }), "win32")).toBe("paste");
    expect(clipboardKey(press("Insert", { shiftKey: true }), "win32")).toBe("paste");
  });

  test("Ctrl+C and Ctrl+V still reach the shell", () => {
    expect(clipboardKey(press("c", { ctrlKey: true }), "win32")).toBeNull();
    expect(clipboardKey(press("v", { ctrlKey: true }), "win32")).toBeNull();
  });

  test("macOS and Linux are untouched", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(clipboardKey(press("C", { ctrlKey: true, shiftKey: true }), platform)).toBeNull();
      expect(clipboardKey(press("Insert", { shiftKey: true }), platform)).toBeNull();
    }
  });
});
