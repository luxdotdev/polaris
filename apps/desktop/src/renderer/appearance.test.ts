import { afterEach, expect, test } from "bun:test";
import { setClientPlatform } from "../shared/platform.ts";
import { type AppearanceRoot, applyAppearance } from "./appearance.ts";

const root = (): AppearanceRoot => ({
  dataset: {},
  style: { setProperty: () => {}, removeProperty: () => "" },
});

const appearance = {
  theme: "system",
  density: "balanced",
  textSize: "default",
  diffPalette: "default",
  motion: "system",
  codeFont: "sf-mono",
  codeFontSize: 13,
  wordWrap: false,
} as const;

afterEach(() => setClientPlatform(null));

test("the root names the Client's OS, so Windows-only styles can key on it", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    setClientPlatform(platform);
    const target = root();

    applyAppearance(appearance, target);

    expect(target.dataset.platform).toBe(platform);
  }
});
