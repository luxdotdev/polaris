import { afterEach, describe, expect, test } from "bun:test";
import {
  clientPlatform,
  isMac,
  isWindows,
  platformFromArgv,
  setClientPlatform,
  toClientPlatform,
} from "./platform.ts";

afterEach(() => setClientPlatform(null));

describe("clientPlatform", () => {
  test("folds Node platforms into darwin, win32 and linux", () => {
    expect(toClientPlatform("darwin")).toBe("darwin");
    expect(toClientPlatform("win32")).toBe("win32");
    expect(toClientPlatform("linux")).toBe("linux");
    expect(toClientPlatform("freebsd")).toBe("linux");
  });

  test("defaults to this process's platform", () => {
    expect(clientPlatform()).toBe(toClientPlatform(process.platform));
  });

  test("prefers what the preload exposed on window.polaris", () => {
    // SAFETY: the test owns `polaris` on globalThis and restores it below.
    const host = globalThis as { polaris?: { platform?: string } };
    const before = host.polaris;

    host.polaris = { platform: process.platform === "win32" ? "darwin" : "win32" };

    try {
      expect(clientPlatform()).toBe(process.platform === "win32" ? "darwin" : "win32");
    } finally {
      if (before === undefined) delete host.polaris;
      else host.polaris = before;
    }
  });

  test("a test override wins and resets", () => {
    setClientPlatform("win32");
    expect(clientPlatform()).toBe("win32");
    expect(isWindows()).toBe(true);
    expect(isMac()).toBe(false);

    setClientPlatform("darwin");
    expect(isMac()).toBe(true);

    setClientPlatform(null);
    expect(clientPlatform()).toBe(toClientPlatform(process.platform));
  });
});

describe("platformFromArgv", () => {
  test("reads the platform main passed to the preload", () => {
    expect(platformFromArgv(["electron", "--polaris-platform=win32"], "darwin")).toBe("win32");
  });

  test("falls back to the process's own", () => {
    expect(platformFromArgv(["electron"], "darwin")).toBe("darwin");
  });
});
