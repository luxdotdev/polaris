import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import {
  type Bucket,
  compactTokens,
  costCaption,
  costLabel,
  dayTip,
  formatShare,
  splitByDefault,
  pricedEstimate,
  rangeWindow,
  usageSummary,
} from "./usage.ts";

const NOW = Date.parse("2026-09-30T15:00:00Z");

const tokens = (input: number, output = 0) => ({
  input,
  cacheRead: 0,
  cacheWrite: 0,
  output,
  reasoning: 0,
  cacheWrite1h: 0,
});

const bucket = (patch: Partial<Bucket> & Pick<Bucket, "hour">): Bucket => ({
  harness: "claude",
  model: "opus-5",
  sessionId: null,
  tokens: tokens(100),
  reportedCost: null,
  longContext: [],
  ...patch,
});

describe("usageSummary", () => {
  test("totals, the share in Polaris sessions, and days in the range only", () => {
    const summary = usageSummary({
      days: 7,
      now: NOW,
      buckets: [
        bucket({ hour: "2026-09-30T10:00:00Z", sessionId: SessionId.make("s1") }),
        bucket({
          hour: "2026-09-29T10:00:00Z",
          harness: "codex",
          model: "gpt-5.4",
          tokens: tokens(200, 100),
        }),
        bucket({ hour: "2026-09-01T10:00:00Z", tokens: tokens(9999) }),
      ],
    });

    expect(summary.tokens).toBe(400);
    expect(summary.polarisShare).toBe(0.25);
    expect(summary.harnesses).toEqual(["codex", "claude"]);
    expect(summary.days).toHaveLength(7);
    expect(summary.days.at(-1)?.date).toBe("2026-09-30");
    expect(summary.days.at(-1)?.series).toEqual([
      { harness: "codex", polaris: 0, outside: 0 },
      { harness: "claude", polaris: 100, outside: 0 },
    ]);
    expect(summary.byModel.map((r) => [r.model, r.tokens])).toEqual([
      ["gpt-5.4", 300],
      ["opus-5", 100],
    ]);
  });

  test("reported cost is exact; the rest is estimated with a '~', or unpriced", () => {
    const reported = bucket({
      hour: "2026-09-30T10:00:00Z",
      reportedCost: { tokens: tokens(100), usd: 21.4 },
    });

    const unreported = bucket({ hour: "2026-09-30T11:00:00Z", model: "sonnet" });

    const exact = usageSummary({ days: 7, now: NOW, buckets: [reported] });

    expect(costLabel(exact.cost)).toBe("$21.40");

    const unpriced = usageSummary({ days: 7, now: NOW, buckets: [reported, unreported] });

    expect([costLabel(unpriced.cost), unpriced.cost.partial]).toEqual(["$21.40", true]);
    expect(costLabel(unpriced.byModel.find((r) => r.model === "sonnet")!.cost)).toBe("—");

    const estimated = usageSummary({
      days: 7,
      now: NOW,
      buckets: [reported, unreported],
      estimate: (_bucket, t) => t.input * 0.01,
    });

    expect(costLabel(estimated.cost)).toBe("~$22.40");
  });

  test("main's estimate prices a bucket; one with unpriced tokens stays unpriced", () => {
    const summary = usageSummary({
      days: 7,
      now: NOW,
      estimate: pricedEstimate,
      buckets: [
        bucket({
          hour: "2026-09-30T10:00:00Z",
          estimate: { estimatedUsd: 3.5, unpricedTokens: 0 },
        }),
        bucket({
          hour: "2026-09-30T11:00:00Z",
          model: "mystery",
          estimate: { estimatedUsd: 0, unpricedTokens: 100 },
        }),
      ],
    });

    expect(costLabel(summary.cost)).toBe("~$3.50");
    expect(summary.cost.partial).toBe(true);
  });

  test("the query window starts at the first day's midnight, UTC", () => {
    expect(rangeWindow(7, NOW)).toEqual({
      from: "2026-09-24T00:00:00.000Z",
      to: "2026-09-30T15:00:00.000Z",
    });
  });

  test("the cost figure: '~' and 'estimated' only for estimates; unpriced Models said once", () => {
    const estimated = { usd: 7526.651, estimated: true, partial: false };
    const reported = { usd: 21.4, estimated: false, partial: false };

    expect([costLabel(estimated), costCaption(estimated)]).toEqual([
      "~$7,526.65",
      "API-equivalent · estimated",
    ]);
    expect(costCaption({ ...estimated, partial: true })).toBe(
      "API-equivalent · estimated · some models unpriced"
    );
    expect([costLabel(reported), costCaption(reported)]).toEqual([
      "$21.40",
      "Reported by harnesses",
    ]);
    expect(costCaption({ ...reported, partial: true })).toBe(
      "Reported by harnesses · some models unpriced"
    );
  });

  test("costs over a thousand dollars group their digits", () => {
    expect(costLabel({ usd: 4870.849, estimated: true, partial: false })).toBe("~$4,870.85");
  });

  test("compact token figures", () => {
    expect([48_200_000, 912_400, 640, 2_100_000_000].map(compactTokens)).toEqual([
      "48.2M",
      "912K",
      "640",
      "2.1B",
    ]);
  });

  test("a day's tooltip: each Model with tokens and cost, then the day's total", () => {
    const summary = usageSummary({
      days: 7,
      now: NOW,
      estimate: pricedEstimate,
      buckets: [
        bucket({
          hour: "2026-09-30T09:00:00Z",
          model: "opus-5",
          tokens: tokens(1_000_000, 200_000),
          reportedCost: { tokens: tokens(1_000_000, 200_000), usd: 4 },
        }),
        bucket({
          hour: "2026-09-30T10:00:00Z",
          harness: "codex",
          model: "gpt-5.5",
          tokens: tokens(400_000),
          estimate: { estimatedUsd: 1.25, unpricedTokens: 0 },
        }),
        bucket({
          hour: "2026-09-30T11:00:00Z",
          model: "mystery",
          estimate: { estimatedUsd: 0, unpricedTokens: 100 },
        }),
        // Another day: not in today's tooltip.
        bucket({ hour: "2026-09-29T11:00:00Z", model: "sonnet" }),
      ],
    });

    const today = dayTip(summary.days.at(-1)!);

    expect(today).toEqual({
      date: "2026-09-30",
      rows: [
        { key: "claude/opus-5", model: "opus-5", harness: "claude", tokens: "1.2M", cost: "$4.00" },
        {
          key: "codex/gpt-5.5",
          model: "gpt-5.5",
          harness: "codex",
          tokens: "400K",
          cost: "~$1.25",
        },
        {
          key: "claude/mystery",
          model: "mystery",
          harness: "claude",
          tokens: "100",
          cost: "no price",
        },
      ],
      tokens: "1.6M",
      cost: "~$5.25 + no price",
    });
    expect(dayTip(summary.days.at(-2)!).rows.map((r) => r.model)).toEqual(["sonnet"]);

    const idle = dayTip(summary.days[0]!);

    expect([idle.rows, idle.tokens, idle.cost]).toEqual([[], "0", ""]);
  });
});

describe("formatShare", () => {
  test('a little in Polaris sessions is never "0%"', () => {
    // 252k of 16.3B tokens: two test sessions on a Host used mostly outside Polaris.
    expect(formatShare(252_439 / 16_326_056_227)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(0.42)).toBe("42%");
    expect(formatShare(0.998)).toBe(">99%");
    expect(formatShare(1)).toBe("100%");
    expect(formatShare(null)).toBe("—");
  });
});

describe("splitByDefault", () => {
  test("the split starts on only with Polaris Usage worth setting apart", () => {
    expect(splitByDefault(252_439 / 16_326_056_227)).toBe(false);
    expect(splitByDefault(null)).toBe(false);
    expect(splitByDefault(0.01)).toBe(true);
    expect(splitByDefault(0.4)).toBe(true);
  });
});
