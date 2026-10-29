import { afterEach, describe, expect, test } from "bun:test";
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
  rangeDays,
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

  test("the query window starts at the first day's local midnight (here UTC)", () => {
    expect(rangeWindow(7, NOW)).toEqual({
      from: "2026-09-24T00:00:00.000Z",
      to: "2026-09-30T15:00:00.000Z",
    });
  });

  test("the cost figure: '~', grouped digits and 'estimated' only for estimates; unpriced Models said once", () => {
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

  test("a figure that rounds up to the next unit takes it", () => {
    expect([999_600, 999_960_000, 999_960_000_000, 1_284_000_000_000].map(compactTokens)).toEqual([
      "1.0M",
      "1.0B",
      "1.0T",
      "1.3T",
    ]);
  });

  test("a fraction of a cent reads as under a cent, not as nothing", () => {
    const tiny = { usd: 0.000_004, estimated: true, partial: false };

    expect([costLabel(tiny), costLabel({ ...tiny, estimated: false })]).toEqual([
      "~<$0.01",
      "<$0.01",
    ]);
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
        {
          key: "claude/opus-5",
          model: "opus-5",
          harness: "claude",
          tokens: "1.2M",
          cost: "$4.00",
          outside: false,
        },
        {
          key: "codex/gpt-5.5",
          model: "gpt-5.5",
          harness: "codex",
          tokens: "400K",
          cost: "~$1.25",
          outside: false,
        },
        {
          key: "claude/mystery",
          model: "mystery",
          harness: "claude",
          tokens: "100",
          cost: "no price",
          outside: false,
        },
      ],
      polaris: null,
      tokens: "1.6M",
      cost: "~$5.25 + no price",
    });
    expect(dayTip(summary.days.at(-2)!).rows.map((r) => r.model)).toEqual(["sonnet"]);

    const idle = dayTip(summary.days[0]!);

    expect([idle.rows, idle.tokens, idle.cost]).toEqual([[], "0", ""]);
  });
});

describe("the split tooltip", () => {
  const day = () =>
    usageSummary({
      days: 7,
      now: NOW,
      buckets: [
        bucket({
          hour: "2026-09-30T09:00:00Z",
          sessionId: SessionId.make("s1"),
          tokens: tokens(300),
        }),
        bucket({
          hour: "2026-09-30T10:00:00Z",
          sessionId: SessionId.make("s2"),
          harness: "codex",
          model: "gpt-5.5",
          tokens: tokens(200),
        }),
        bucket({ hour: "2026-09-30T11:00:00Z", tokens: tokens(900) }),
      ],
    }).days.at(-1)!;

  test("Polaris rows first with their subtotal, then outside rows marked to dim", () => {
    const tip = dayTip(day(), true);

    expect(tip.rows.map((r) => [r.key, r.tokens, r.outside])).toEqual([
      ["claude/opus-5", "300", false],
      ["codex/gpt-5.5", "200", false],
      ["claude/opus-5/outside", "900", true],
    ]);
    expect(tip.polaris?.tokens).toBe("500");
    expect(tip.tokens).toBe("1K");
  });

  test("unsplit, a Model's rows merge and nothing is dimmed", () => {
    const tip = dayTip(day(), false);

    expect(tip.rows.map((r) => [r.key, r.tokens, r.outside])).toEqual([
      ["claude/opus-5", "1K", false],
      ["codex/gpt-5.5", "200", false],
    ]);
    expect(tip.polaris).toBeNull();
  });

  test("no subtotal when the day ran all in, or all outside, Polaris", () => {
    const outside = usageSummary({
      days: 7,
      now: NOW,
      buckets: [bucket({ hour: "2026-09-30T11:00:00Z" })],
    }).days.at(-1)!;

    expect(dayTip(outside, true).polaris).toBeNull();
    expect(dayTip(outside, true).rows.every((r) => r.outside)).toBe(true);
  });
});

describe("local days", () => {
  // Bun's test zone is UTC; deleting TZ instead would freeze the last zone set.
  const zone = process.env.TZ ?? "Etc/UTC";

  afterEach(() => {
    process.env.TZ = zone;
  });

  const at = (hour: string) => bucket({ hour });

  test("after 8pm EDT, Today is still the local day and holds the evening's hours", () => {
    process.env.TZ = "America/New_York";

    const now = Date.parse("2026-10-12T01:00:00Z");

    const summary = usageSummary({
      days: 7,
      now,
      buckets: [at("2026-10-12T00:00:00Z"), at("2026-10-11T12:00:00Z"), at("2026-10-11T03:00:00Z")],
    });

    expect(summary.days.at(-1)?.date).toBe("2026-10-11");
    expect(summary.days.at(-1)?.total).toBe(200);
    expect(summary.days.at(-2)?.total).toBe(100);
    expect(rangeWindow(7, now).from).toBe("2026-10-05T04:00:00.000Z");
  });

  test("a half-hour zone: an hour straddling midnight counts in the day it starts", () => {
    process.env.TZ = "Asia/Kolkata";

    const now = Date.parse("2026-10-11T19:00:00Z");

    const summary = usageSummary({
      days: 7,
      now,
      buckets: [at("2026-10-11T18:00:00Z"), at("2026-10-11T19:00:00Z")],
    });

    expect(summary.days.at(-1)).toMatchObject({ date: "2026-10-12", total: 100 });
    expect(summary.days.at(-2)).toMatchObject({ date: "2026-10-11", total: 100 });
    expect(rangeWindow(7, now).from).toBe("2026-10-05T18:30:00.000Z");
  });

  test("a range across the end of daylight saving has every day once", () => {
    process.env.TZ = "America/New_York";
    expect(rangeDays(7, Date.parse("2026-11-03T12:00:00Z"))).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
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
