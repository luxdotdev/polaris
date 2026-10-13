import { describe, expect, test } from "bun:test";
import { clientCopy } from "./clientCopy.ts";

describe("clientCopy", () => {
  test("macOS and Linux keep the macOS wording", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(clientCopy(platform)).toMatchObject({
        machine: "this Mac",
        os: "macOS",
        reveal: "Reveal in Finder",
        showApp: "Show in Finder",
      });
    }
  });

  test("Windows names the PC, Explorer and Windows", () => {
    expect(clientCopy("win32")).toMatchObject({
      machine: "this PC",
      os: "Windows",
      reveal: "Show in Explorer",
      showApp: "Show in Explorer",
    });
  });

  test("no Windows copy mentions the Mac, Finder, macOS or the keychain", () => {
    for (const text of Object.values(clientCopy("win32"))) {
      expect(text).not.toMatch(/\bMac\b|macOS|Finder|keychain/i);
    }
  });
});
