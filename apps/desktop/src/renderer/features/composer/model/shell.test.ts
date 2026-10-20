import { describe, expect, test } from "bun:test";
import { isShellDraft, leaveShell, shellCommandOf, shellDraft } from "./shell.ts";

describe("shell mode", () => {
  test("a leading `!` enters it only where the Host and Harness run shell commands", () => {
    expect(isShellDraft("!ls", true)).toBe(true);
    expect(isShellDraft("!ls", false)).toBe(false);
    expect(isShellDraft("ls !", true)).toBe(false);
  });

  test("esc leaves it, keeping what was typed", () => {
    expect(leaveShell("!git log")).toBe("git log");
    expect(isShellDraft(leaveShell("!git log"), true)).toBe(false);
  });

  test("a sent command comes back from history in shell mode, as it was run", () => {
    const back = shellDraft("bun test");

    expect([isShellDraft(back, true), shellCommandOf(back)]).toEqual([true, "bun test"]);
  });
});
