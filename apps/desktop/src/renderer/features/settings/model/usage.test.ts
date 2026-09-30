import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import {
  type Bucket,
  compactTokens,
  costLabel,
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

  test("compact token figures", () => {
    expect([48_200_000, 912_400, 640, 2_100_000_000].map(compactTokens)).toEqual([
      "48.2M",
      "912K",
      "640",
      "2.1B",
    ]);
  });
});
