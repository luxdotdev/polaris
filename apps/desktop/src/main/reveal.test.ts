import { expect, test } from "bun:test";
import { appRevealPath } from "./reveal.ts";

test("macOS selects the app bundle", () => {
  expect(appRevealPath("darwin", "/Applications/Polaris.app/Contents/MacOS/Polaris")).toBe(
    "/Applications/Polaris.app"
  );
});

test("Windows selects Polaris.exe in its install folder", () => {
  const exe = String.raw`C:\Users\me\AppData\Local\Polaris\app-1.2.0\Polaris.exe`;

  expect(appRevealPath("win32", exe)).toBe(exe);
});
