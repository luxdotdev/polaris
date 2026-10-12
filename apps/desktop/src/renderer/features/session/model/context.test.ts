import { describe, expect, test } from "bun:test";
import { compactionLine, contextCard, rowShare, rowTokens, sessionSpend } from "./context.ts";

type Kind = "used" | "free" | "buffer" | "deferred";

const usage = (
  usedTokens: number,
  windowTokens: number | null,
  categories: ReadonlyArray<readonly [string, Kind, number]> = [],
  categoriesTotal: number | null = null
) => ({
  usedTokens,
  windowTokens,
  categories: categories.map(([name, kind, tokens]) => ({ name, kind, tokens })),
  memoryFiles: [
    { path: "/repo/CLAUDE.md", source: "Project", tokens: 3000 },
    { path: "/repo/AGENTS.md", source: "Project", tokens: 1600 },
  ],
  categoriesTotal,
  autoCompact: true,
});

const claude = (used = 124_000, total: number | null = 124_000) =>
  usage(
    used,
    200_000,
    [
      ["System prompt", "used", 4_400],
      ["System tools", "used", 20_000],
      ["MCP tools", "used", 5_000],
      ["Memory files", "used", 4_600],
      ["Messages", "used", 90_000],
      ["Free space", "free", 31_000],
      ["Autocompact buffer", "buffer", 45_000],
      ["Skills (deferred)", "deferred", 9_000],
    ],
    total
  );

describe("contextCard", () => {
  test("Claude: grouped as the card shows them, the conversation first", () => {
    const card = contextCard(claude());

    expect(card.percent).toBe(62);
    expect(card.legend.map((s) => [s.label, s.tokens])).toEqual([
      ["Conversation", 90_000],
      ["System prompt and tools", 29_400],
      ["Memory files", 4_600],
      ["Free", 31_000],
      ["Kept free for auto-compact", 45_000],
    ]);
    expect(card.legend[2]?.files).toBe("CLAUDE.md, AGENTS.md");
  });

  test("100 cells in window order: system, memory, conversation, free, then the reserve", () => {
    const { cells } = contextCard(claude());

    const runs = cells.map((c) => c.key).filter((key, i, keys) => key !== keys[i - 1]);

    expect(cells).toHaveLength(100);
    expect(runs).toEqual(["system", "memory", "conversation", "free", "reserve"]);
    expect(cells.filter((c) => c.key === "reserve")).toHaveLength(22);
  });

  test("tokens used since the count go to the conversation, out of free space", () => {
    const card = contextCard(claude(130_000, 124_000));

    expect(card.legend[0]?.tokens).toBe(96_000);
    expect(card.legend.find((s) => s.key === "free")?.tokens).toBe(25_000);
  });

  test("other Harnesses: the total and what's free, no reserve", () => {
    const card = contextCard(usage(236_000, 258_000));

    expect(card.nearlyFull).toBe(true);
    expect(card.legend.map((s) => [s.label, s.tokens])).toEqual([
      ["In context", 236_000],
      ["Free", 22_000],
    ]);
    expect(card.cells.filter((c) => c.key === "used")).toHaveLength(91);
  });

  test("an unknown window: the total only, no meter", () => {
    const card = contextCard(usage(84_000, null));

    expect([card.window, card.percent, card.cells.length, card.legend.length]).toEqual([
      null,
      null,
      0,
      0,
    ]);
  });

  test("an unnamed category keeps its own row", () => {
    const card = contextCard(usage(10_000, 100_000, [["Plugins", "used", 10_000]]));

    expect(card.legend.map((s) => s.label)).toEqual(["Plugins", "Free"]);
  });
});

describe("formatting", () => {
  test("rows: one decimal under 100k", () => {
    expect([rowTokens(900), rowTokens(4_600), rowTokens(90_000), rowTokens(119_000)]).toEqual([
      "900",
      "4.6k",
      "90.0k",
      "119k",
    ]);
  });

  test("shares: a sliver reads <1%", () => {
    expect([rowShare(90_000, 200_000), rowShare(400, 200_000), rowShare(0, 200_000)]).toEqual([
      "45%",
      "<1%",
      "0%",
    ]);
  });

  test("compaction: before and after, as far as the Harness said", () => {
    const at = "2026-10-11T10:00:00.000Z";
    const base = { turnId: null, trigger: "auto" as const, at };

    expect(compactionLine({ ...base, beforeTokens: 188_000, afterTokens: 36_000 }, 31)).toBe(
      "Compacted at turn 31 · 188k → 36k"
    );
    expect(compactionLine({ ...base, beforeTokens: 188_000, afterTokens: null }, null)).toBe(
      "Compacted · from 188k"
    );
    expect(compactionLine({ ...base, beforeTokens: null, afterTokens: null }, 4)).toBe(
      "Compacted at turn 4"
    );
  });
});

describe("sessionSpend", () => {
  const tokens = { input: 100_000, cacheRead: 900_000, cacheWrite: 0, output: 20_000 };

  test("reported cost is exact; estimated cost reads ~", () => {
    expect(sessionSpend([{ tokens, reportedCost: { usd: 1.5 } }])).toEqual({
      line: "This session · 1M tokens · $1.50",
      detail: "90% read from cache",
    });
    expect(
      sessionSpend([
        { tokens, reportedCost: null, estimate: { estimatedUsd: 4.12, unpricedTokens: 0 } },
      ])?.line
    ).toBe("This session · 1M tokens · ~$4.12");
  });

  test("nothing priced: the tokens, and says so", () => {
    expect(sessionSpend([{ tokens, reportedCost: null }])).toEqual({
      line: "This session · 1M tokens",
      detail: "No cost reported",
    });
    expect(sessionSpend([])).toBeNull();
  });
});
