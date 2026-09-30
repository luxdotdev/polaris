import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LongContextTokens,
  ReportedCost,
  SessionId,
  TokenCounts,
  UsageBucket,
} from "@polaris/protocol";
import { Effect } from "effect";
import { bucketCost } from "./cost.ts";
import { bundledPrices, PriceBook, PriceListError } from "./PriceBook.ts";
import { buildPriceTable, LITELLM_URL, MODELS_DEV_URL, resolvePrice } from "./prices.ts";
import { summarizeUsage } from "./summary.ts";

/** Round prices so the arithmetic below reads plainly: $1, $10… per million tokens. */
const M = 1e-6;

const LITELLM_ENTRIES = {
  "claude-test": {
    input_cost_per_token: 1 * M,
    output_cost_per_token: 10 * M,
    cache_read_input_token_cost: 0.1 * M,
    cache_creation_input_token_cost: 1.25 * M,
    cache_creation_input_token_cost_above_1hr: 2 * M,
    input_cost_per_token_above_200k_tokens: 2 * M,
    output_cost_per_token_above_200k_tokens: 15 * M,
  },
  "gpt-test": {
    input_cost_per_token: 2 * M,
    output_cost_per_token: 20 * M,
    cache_read_input_token_cost: 0.2 * M,
    input_cost_per_token_above_272k_tokens: 4 * M,
    output_cost_per_token_above_272k_tokens: 30 * M,
    cache_read_input_token_cost_above_272k_tokens: 0.4 * M,
    input_cost_per_token_priority: 5 * M,
    output_cost_per_token_priority: 50 * M,
    cache_read_input_token_cost_priority: 0.5 * M,
  },
  "gpt-5.5": { input_cost_per_token: 1 * M, output_cost_per_token: 1 * M },
  "no-output": { input_cost_per_token: 1 * M },
  "bedrock/claude-test": { input_cost_per_token: 99 * M, output_cost_per_token: 99 * M },
  sample_spec: { note: "LiteLLM's own schema entry" },
};

const LITELLM = JSON.stringify(LITELLM_ENTRIES);

const MODELS_DEV = JSON.stringify({
  reseller: { models: { "vendor-model": { cost: { input: 9, output: 9 } } } },
  anthropic: {
    models: {
      "vendor-model": {
        cost: {
          input: 3,
          output: 15,
          cache_read: 0.3,
          tiers: [
            { input: 6, output: 22.5, cache_read: 0.6, tier: { type: "context", size: 200_000 } },
          ],
        },
      },
      "claude-test": { cost: { input: 100, output: 100 } },
      "no-cost": {},
    },
  },
});

const table = buildPriceTable(LITELLM, MODELS_DEV, "2026-09-01T00:00:00.000Z");

const tokens = (t: Partial<TokenCounts> = {}) =>
  new TokenCounts({
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    cacheWrite1h: 0,
    ...t,
  });

const bucket = (b: {
  model: string;
  tokens: TokenCounts;
  hour?: string;
  harness?: string;
  sessionId?: string | null;
  reportedCost?: ReportedCost | null;
  longContext?: ReadonlyArray<LongContextTokens>;
}) =>
  new UsageBucket({
    hour: b.hour ?? "2026-09-01T10:00:00.000Z",
    harness: b.harness ?? "claude",
    model: b.model,
    sessionId: b.sessionId ? SessionId.make(b.sessionId) : null,
    tokens: b.tokens,
    reportedCost: b.reportedCost ?? null,
    longContext: b.longContext ?? [],
  });

const usd = (value: number) => Math.round(value * 1e9) / 1e9;

describe("price lists", () => {
  test("LiteLLM entries by vendor id; models.dev fills the gaps, the Model's vendor first", () => {
    expect(Object.keys(table.models).sort()).toEqual([
      "claude-test",
      "gpt-5.5",
      "gpt-test",
      "vendor-model",
    ]);
    expect(table.models["claude-test"]?.source).toBe("litellm");

    const vendor = table.models["vendor-model"];
    expect(vendor?.source).toBe("models.dev");
    expect(vendor?.base.input).toBeCloseTo(3 * M);
    expect(vendor?.base.cacheWrite).toBeCloseTo(3.75 * M);
    expect(vendor?.longContext?.above).toBe(200_000);
  });

  test("rates a list leaves out follow ccusage: writes 1.25×, reads 0.1×, one-hour writes 2× input", () => {
    const price = table.models["gpt-5.5"];

    expect(price?.base.cacheWrite).toBeCloseTo(1.25 * M);
    expect(price?.base.cacheRead).toBeCloseTo(0.1 * M);
    expect(price?.base.cacheWrite1h).toBeCloseTo(2 * M);
  });

  test("unknown Models have no price; -fast uses priority rates, else a known multiplier", () => {
    expect(resolvePrice(table, "claude-unknown")).toBeNull();
    expect(resolvePrice(table, "claude-test-fast")).toBeNull();
    expect(resolvePrice(table, "anthropic/claude-test")?.rates.input).toBeCloseTo(1 * M);
    expect(resolvePrice(table, "gpt-test-fast")?.rates.output).toBeCloseTo(50 * M);
    expect(resolvePrice(table, "gpt-5.5-fast")?.rates.output).toBeCloseTo(2.5 * M);
  });
});

describe("bucketCost", () => {
  test("five-minute and one-hour cache writes are priced apart; reasoning is part of output", () => {
    const cost = bucketCost(
      bucket({
        model: "claude-test",
        tokens: tokens({
          input: 1e6,
          cacheRead: 1e6,
          cacheWrite: 3e6,
          cacheWrite1h: 1e6,
          output: 1e6,
          reasoning: 5e5,
        }),
      }),
      table
    );

    // 1 + 0.1 + 2 × 1.25 + 1 × 2 + 10
    expect(usd(cost.estimatedUsd)).toBe(15.6);
    expect(cost.reportedUsd).toBe(0);
  });

  test("a long request is priced entirely at long-context rates, at the Model's threshold", () => {
    const long = tokens({ input: 1e6, output: 1e6 });

    const cost = (model: string, above: number) =>
      usd(
        bucketCost(
          bucket({
            model,
            tokens: tokens({ input: 2e6, output: 2e6 }),
            longContext: [new LongContextTokens({ above, tokens: long })],
          }),
          table
        ).usd
      );

    // Claude: 200k. Short half 1 + 10, long half 2 + 15.
    expect(cost("claude-test", 200_000)).toBe(28);
    // A 272k subset doesn't apply to a 200k Model: all short.
    expect(cost("claude-test", 272_000)).toBe(22);
    // OpenAI: 272k. Short half 2 + 20, long half 4 + 30.
    expect(cost("gpt-test", 272_000)).toBe(56);
  });

  test("a reported cost wins for the tokens it covers; the rest is estimated", () => {
    const cost = bucketCost(
      bucket({
        model: "claude-test",
        tokens: tokens({ input: 2e6, output: 2e6 }),
        reportedCost: new ReportedCost({ usd: 7, tokens: tokens({ input: 1e6, output: 1e6 }) }),
      }),
      table
    );

    expect([cost.reportedUsd, usd(cost.estimatedUsd), usd(cost.usd)]).toEqual([7, 11, 18]);
  });

  test("an unknown Model's tokens are counted as unpriced, never guessed", () => {
    const cost = bucketCost(
      bucket({ model: "mystery", tokens: tokens({ input: 5, output: 7 }) }),
      table
    );

    expect(cost).toEqual({ usd: 0, reportedUsd: 0, estimatedUsd: 0, unpricedTokens: 12 });
  });
});

describe("summarizeUsage", () => {
  test("totals by Harness, Model, Host and local day, and the share through Polaris", () => {
    const summary = summarizeUsage({
      prices: table,
      timeZone: "America/New_York",
      hosts: [
        {
          host: "studio",
          buckets: [
            // 03:00 UTC is still the previous day in New York.
            bucket({
              model: "claude-test",
              hour: "2026-09-02T03:00:00.000Z",
              tokens: tokens({ output: 1e6 }),
              sessionId: "s1",
            }),
            bucket({
              model: "claude-test",
              hour: "2026-09-02T15:00:00.000Z",
              tokens: tokens({ output: 1e6 }),
            }),
          ],
        },
        {
          host: "pi",
          buckets: [
            bucket({
              harness: "codex",
              model: "gpt-test",
              hour: "2026-09-02T15:00:00.000Z",
              tokens: tokens({ output: 1e6 }),
            }),
            bucket({
              harness: "codex",
              model: "mystery",
              hour: "2026-09-02T15:00:00.000Z",
              tokens: tokens({ output: 3 }),
            }),
          ],
        },
      ],
    });

    expect(usd(summary.total.cost.usd)).toBe(40);
    expect(summary.total.unpricedModels).toEqual(["mystery"]);
    expect(summary.total.cost.unpricedTokens).toBe(3);
    expect(usd(summary.polaris.cost.usd)).toBe(10);
    expect(summary.polaris.tokens.output).toBe(1e6);
    expect(summary.byHarness.map((h) => [h.harness, usd(h.total.cost.usd)])).toEqual([
      ["claude", 20],
      ["codex", 20],
    ]);
    expect(summary.byModel.map((m) => `${m.harness}/${m.model}`)).toEqual([
      "claude/claude-test",
      "codex/gpt-test",
      "codex/mystery",
    ]);
    expect(summary.byHost.map((h) => [h.host, usd(h.total.cost.usd)])).toEqual([
      ["studio", 20],
      ["pi", 20],
    ]);
    expect(summary.byDay.map((d) => [d.day, usd(d.total.cost.usd)])).toEqual([
      ["2026-09-01", 10],
      ["2026-09-02", 30],
    ]);
    expect(summary.pricesFetchedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("PriceBook", () => {
  const dirs: Array<string> = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A price list big enough to be believed, from the fixture's entries. */
  const bigList = () => {
    const filler = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [
        `filler-${i}`,
        { input_cost_per_token: M, output_cost_per_token: M },
      ])
    );

    return JSON.stringify({ ...LITELLM_ENTRIES, ...filler });
  };

  const setup = (fetchText: (url: string) => Promise<string>) => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-prices-"));
    dirs.push(dir);
    const cacheFile = join(dir, "prices.json");

    const run = <A, E>(body: Effect.Effect<A, E, PriceBook>) =>
      Effect.runPromise(body.pipe(Effect.provide(PriceBook.layer({ cacheFile, fetchText }))));

    return { cacheFile, run };
  };

  test("uses the bundled snapshot until it has fetched, then the cached fetch", async () => {
    const fetched: Array<string> = [];

    const { cacheFile, run } = setup(async (url) => {
      fetched.push(url);

      return url === LITELLM_URL ? bigList() : MODELS_DEV;
    });

    const before = await run(Effect.flatMap(PriceBook, (book) => book.current));
    expect(before.fetchedAt).toBe(bundledPrices().fetchedAt);

    await run(Effect.flatMap(PriceBook, (book) => book.refresh));
    expect(fetched.sort()).toEqual([LITELLM_URL, MODELS_DEV_URL].sort());
    expect(existsSync(cacheFile)).toBe(true);

    const after = await run(Effect.flatMap(PriceBook, (book) => book.current));
    expect(after.models["vendor-model"]?.source).toBe("models.dev");
    expect(after.fetchedAt).not.toBe(bundledPrices().fetchedAt);
  });

  test("a broken download fails the refresh and keeps the table; models.dev is optional", async () => {
    const broken = setup(async () => "{}");
    const error = await broken.run(Effect.flip(Effect.flatMap(PriceBook, (book) => book.refresh)));
    expect(error).toBeInstanceOf(PriceListError);

    const kept = await broken.run(Effect.flatMap(PriceBook, (book) => book.refreshIfStale));
    expect(kept.fetchedAt).toBe(bundledPrices().fetchedAt);

    const liteLlmOnly = setup(async (url) => {
      if (url === MODELS_DEV_URL) throw new Error("offline");

      return bigList();
    });

    const table = await liteLlmOnly.run(Effect.flatMap(PriceBook, (book) => book.refresh));
    expect(table.models["claude-test"]).toBeDefined();
    expect(table.models["vendor-model"]).toBeUndefined();
  });

  test("the bundled snapshot prices the Models Polaris's Harnesses run", () => {
    const bundled = bundledPrices();

    for (const model of ["claude-opus-5-5", "claude-sonnet-5", "gpt-5.5", "gpt-5.5-fast"])
      expect(resolvePrice(bundled, model)).not.toBeNull();
  });
});
