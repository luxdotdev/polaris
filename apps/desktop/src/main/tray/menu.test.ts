import { describe, expect, test } from "bun:test";
import { menuTemplate, type StarTrayInput } from "./menu.ts";

const input: StarTrayInput = { onOpenSession: () => {}, onOpenApp: () => {}, onQuit: () => {} };

const empty = { count: 0, sessions: [], focused: null };

describe("star menu", () => {
  test("macOS and Linux show Quit's chord", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(menuTemplate(empty, input, platform).at(-1)).toMatchObject({
        label: "Quit Polaris",
        accelerator: "CmdOrCtrl+Q",
      });
    }
  });

  test("Windows shows none, as its notification-area menus don't", () => {
    const quit = menuTemplate(empty, input, "win32").at(-1);

    expect(quit?.label).toBe("Quit Polaris");
    expect(quit).not.toHaveProperty("accelerator");
  });
});
