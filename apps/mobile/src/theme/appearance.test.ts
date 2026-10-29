import { describe, expect, test } from "bun:test";
import {
  type Appearance,
  type AppearanceStore,
  defaultAppearance,
  devAppearanceLink,
  loadAppearance,
  type MotionPreference,
  resolveReducedMotion,
  saveAppearance,
} from "./appearance.ts";

const memoryStore = (initial: string | null = null): AppearanceStore & { text: string | null } => {
  const store = {
    text: initial,
    read: () => store.text,
    write: async (text: string) => {
      store.text = text;
    },
  };

  return store;
};

describe("appearance persistence", () => {
  test("a fresh phone opens in Midnight, following the system's Reduce Motion", () => {
    expect(loadAppearance(memoryStore())).toEqual({ theme: "midnight", motion: "system" });
  });

  test("a saved theme and motion come back on the next launch", async () => {
    const store = memoryStore();

    await saveAppearance(store, { theme: "moonlit", motion: "reduced" });

    expect(loadAppearance(store)).toEqual({ theme: "moonlit", motion: "reduced" });
  });

  test("an unreadable choice falls back alone; a broken file or failed read falls back whole", () => {
    expect(loadAppearance(memoryStore('{"theme":"moonlit","motion":"wobbly"}'))).toEqual({
      theme: "moonlit",
      motion: "system",
    });
    expect(loadAppearance(memoryStore("{not json"))).toEqual(defaultAppearance);
    expect(
      loadAppearance({
        read: () => {
          throw new Error("no document directory");
        },
        write: async () => undefined,
      })
    ).toEqual(defaultAppearance);
  });
});

describe("reduced motion", () => {
  test.each<[MotionPreference, boolean, boolean]>([
    ["system", false, false],
    ["system", true, true],
    ["reduced", false, true],
    ["reduced", true, true],
    ["full", false, false],
    ["full", true, false],
  ])("%s with iOS Reduce Motion %p is reduced: %p", (motion, system, reduced) => {
    expect(resolveReducedMotion(motion, system)).toBe(reduced);
  });
});

describe("development links", () => {
  test.each<[string, Partial<Appearance> | null]>([
    ["polaris://dev/theme/moonlit", { theme: "moonlit" }],
    ["polaris://dev/motion/reduced", { motion: "reduced" }],
    ["polaris://dev/theme/daylight", null],
    ["polaris://session/abc", null],
  ])("%s", (url, change) => {
    expect(devAppearanceLink(url)).toEqual(change);
  });
});
