import { expect, test } from "bun:test";
import { bundledPrices } from "@polaris/client/usage";
import {
  ConstellationFinding,
  ConstellationRejected,
  GitError,
  ModelId,
  ReportedCost,
  TokenCounts,
  UsageBucket,
} from "@polaris/protocol";
import { constellationError, priceUsage } from "./constellation.ts";

test("a refusal's findings become one line each, '<message>. <fix>'", () => {
  const error = new ConstellationRejected({
    findings: [
      new ConstellationFinding({
        code: "E-REVISION",
        message: "B1 changed since you looked.",
        fix: "Review it again at revision 4",
      }),
      new ConstellationFinding({ code: "E-SETTLED", message: "A2 is settled", fix: "Leave it" }),
    ],
    graph: null,
    revision: 4,
  });

  expect(constellationError(error)).toEqual({
    code: "ConstellationRejected",
    message: "B1 changed since you looked. Review it again at revision 4\nA2 is settled. Leave it",
  });
  expect(constellationError(new GitError({ cwd: "/x", message: "gone" }))).toEqual({
    code: "GitError",
    message: "gone",
  });
});

const tokens = (input: number, output: number) =>
  new TokenCounts({ input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0, cacheWrite1h: 0 });

const bucket = (model: string, reportedUsd: number | null) =>
  new UsageBucket({
    hour: "2026-10-01T12:00:00.000Z",
    harness: "claude",
    model: ModelId.make(model),
    sessionId: null,
    tokens: tokens(1_000_000, 100_000),
    reportedCost:
      reportedUsd === null
        ? null
        : new ReportedCost({ usd: reportedUsd, tokens: tokens(1_000_000, 100_000) }),
    longContext: [],
  });

test("Stats usage is priced like Usage: reported cost kept, the rest estimated, unknown Models counted", () => {
  const usage = {
    tokens: tokens(3_000_000, 300_000),
    reportedUsd: 2,
    reportedTokens: tokens(1_000_000, 100_000),
    buckets: [
      bucket("claude-opus-4-1", 2),
      bucket("claude-opus-4-1", null),
      bucket("no-such-model", null),
    ],
  };

  const priced = priceUsage(usage, bundledPrices());

  expect(priced.usd).toBeGreaterThan(2);
  expect(priced.estimatedUsd).toBeGreaterThan(0);
  expect(priced.unpricedTokens).toBe(1_100_000);
  expect(priceUsage(usage, null)).toEqual({ usd: 2, estimatedUsd: 0, unpricedTokens: 0 });
});
