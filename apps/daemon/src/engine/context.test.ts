import { ContextCategory, ContextUsage, MemoryFile } from "@polaris/protocol";
import { describe, expect, test } from "bun:test";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { contextChanged, contextUsageOf } from "./context.ts";

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

describe("contextUsageOf", () => {
  const breakdown = {
    categories: [new ContextCategory({ name: "Messages", kind: "used", tokens: 30_000 })],
    memoryFiles: [new MemoryFile({ path: "/repo/CLAUDE.md", source: "Project", tokens: 900 })],
    countedTokens: 40_000,
    autoCompact: true,
  } as const;

  test("a total-only report keeps the last breakdown, dated by what it was counted at", () => {
    const counted = contextUsageOf(
      HarnessEvent.ContextUsed({ usedTokens: 40_000, windowTokens: 200_000, breakdown }),
      null
    );

    const later = contextUsageOf(
      HarnessEvent.ContextUsed({ usedTokens: 52_000, windowTokens: 200_000 }),
      counted
    );

    expect(later).toMatchObject({
      usedTokens: 52_000,
      categoriesTotal: 40_000,
      autoCompact: true,
      categories: breakdown.categories,
      memoryFiles: breakdown.memoryFiles,
    });
  });

  test("a fresh count is recorded even when the total barely moved", () => {
    const counted = contextUsageOf(
      HarnessEvent.ContextUsed({ usedTokens: 40_000, windowTokens: 200_000, breakdown }),
      null
    );

    const recount = contextUsageOf(
      HarnessEvent.ContextUsed({
        usedTokens: 40_100,
        windowTokens: 200_000,
        breakdown: { ...breakdown, countedTokens: 40_100 },
      }),
      counted
    );

    expect(contextChanged(counted, recount)).toBe(true);
  });
});
