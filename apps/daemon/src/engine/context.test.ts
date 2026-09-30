import { ContextUsage } from "@polaris/protocol";
import { describe, expect, test } from "bun:test";
import { contextChanged } from "./context.ts";

const usage = (usedTokens: number, windowTokens: number | null) =>
  new ContextUsage({ usedTokens, windowTokens });

describe("contextChanged", () => {
  test("the first report and a new window are always recorded", () => {
    expect(contextChanged(null, usage(10, null))).toBe(true);
    expect(contextChanged(usage(10, null), usage(10, 200_000))).toBe(true);
  });

  test("a move under one percent of the window is not", () => {
    expect(contextChanged(usage(50_000, 200_000), usage(51_999, 200_000))).toBe(false);
    expect(contextChanged(usage(50_000, 200_000), usage(52_000, 200_000))).toBe(true);
  });

  test("a compaction (a big drop) is", () => {
    expect(contextChanged(usage(180_000, 200_000), usage(30_000, 200_000))).toBe(true);
  });

  test("without a window, a thousand tokens is the step", () => {
    expect(contextChanged(usage(5000, null), usage(5999, null))).toBe(false);
    expect(contextChanged(usage(5000, null), usage(6000, null))).toBe(true);
  });
});
