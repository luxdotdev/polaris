/**
 * Worst-case Usage for the break-UI pass (ENG-499): 90 days of a heavy user on four Harnesses
 * and eighteen Models (long provider-prefixed names, billions of tokens, five-figure costs), one
 * Harness with one tiny bucket, and none. Plan limits include a Model-scoped weekly window.
 */
import { PlanLimit, SessionId, UsageStreamItem } from "@polaris/protocol";
import type { UsageQueryView } from "../../../../shared/api.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const hourAgo = (hours: number) => {
  const d = new Date(Date.now() - hours * 3_600_000);

  d.setUTCMinutes(0, 0, 0);

  return d.toISOString();
};

const tokens = (n: number) => ({
  input: Math.round(n * 0.1),
  cacheRead: Math.round(n * 0.75),
  cacheWrite: Math.round(n * 0.05),
  output: Math.round(n * 0.1),
  reasoning: 0,
  cacheWrite1h: 0,
});

/** Harness, Model and tokens per day: the first is just under a billion a day, to round at a unit. */
const MODELS: ReadonlyArray<readonly [string, string, number]> = [
  ["claude", "claude-opus-5-5", 999_960_000],
  ["claude", "claude-sonnet-5-5", 412_000_000],
  ["claude", "claude-haiku-5-5", 38_400_000],
  ["claude", "claude-opus-4-1-20250805", 9_995_000],
  ["claude", "claude-sonnet-4-5-20250929[1m]", 999_600],
  ["codex", "gpt-6.1-sol", 640_000_000],
  ["codex", "gpt-6.1-sol-codex-max-high-reasoning-preview", 88_000_000],
  ["codex", "gpt-5.3-codex-mini", 4_100_000],
  ["opencode", "openrouter/qwen/qwen3-coder-480b-a35b-instruct:free", 52_000_000],
  ["opencode", "anthropic/claude-sonnet-5-5", 21_000_000],
  ["opencode", "ollama/mellum2-12b-a2.5b:q4_k_m", 3_300_000],
  ["opencode", "google-vertex-anthropic/claude-opus-5-5@20261001", 990],
  ["gemini", "gemini-3.5-pro-preview-11-2026", 140_000_000],
  ["gemini", "gemini-3.5-flash-lite", 9_000_000],
  ["claude", "claude-3-7-sonnet-latest", 1],
  ["codex", "o4-mini-deep-research-2026-06-26", 999],
  ["opencode", "deepseek/deepseek-v4-reasoner", 61_000_000],
  ["gemini", "gemini-2.5-pro", 0],
];

const DAYS = 90;

/** Every Model on every day, half of it in Polaris sessions. */
const HEAVY_BUCKETS = MODELS.flatMap(([harness, model, perDay], m) =>
  Array.from({ length: DAYS }, (_, d) => ({
    hour: hourAgo(d * 24 + (m % 6)),
    harness,
    model,
    sessionId: SessionId.make(d % 2 === 0 ? `ses-${m}-${d}` : `outside-${m}-${d}`),
    tokens: tokens(perDay),
    reportedCost: null,
    longContext: [],
  }))
);

/** $/Mtok, so the Opus rows reach five figures over the range; Gemini 2.5 Pro has no price. */
const RATE = new Map([
  ["claude", 3.1],
  ["codex", 1.4],
  ["opencode", 0.9],
]);

export const HEAVY: UsageQueryView = {
  report: { buckets: HEAVY_BUCKETS, indexedAt: ago(1), indexing: false },
  estimates: HEAVY_BUCKETS.map((b) => {
    const n = b.tokens.input + b.tokens.cacheRead + b.tokens.cacheWrite + b.tokens.output;
    const rate = RATE.get(b.harness);

    return rate === undefined
      ? { estimatedUsd: 0, unpricedTokens: n }
      : { estimatedUsd: (n / 1_000_000) * rate, unpricedTokens: 0 };
  }),
  pricesFetchedAt: ago(60),
};

/** One Harness, one Model, one bucket of a single token. */
export const ONE: UsageQueryView = {
  report: {
    buckets: [
      {
        hour: hourAgo(2),
        harness: "claude",
        model: "claude-haiku-5-5",
        sessionId: SessionId.make("ses-one"),
        tokens: { ...tokens(0), output: 1 },
        reportedCost: null,
        longContext: [],
      },
    ],
    indexedAt: ago(1),
    indexing: false,
  },
  estimates: [{ estimatedUsd: 0.000_004, unpricedTokens: 0 }],
  pricesFetchedAt: ago(60),
};

export const EMPTY: UsageQueryView = {
  report: { buckets: [], indexedAt: ago(1), indexing: false },
  estimates: [],
  pricesFetchedAt: ago(60),
};

const limit = (patch: Partial<PlanLimit> & Pick<PlanLimit, "harness" | "kind">) =>
  UsageStreamItem.cases.PlanLimitChanged.make({
    limit: new PlanLimit({
      scope: null,
      windowMinutes: null,
      usedPercent: null,
      status: "ok",
      resetsAt: null,
      observedAt: ago(3),
      plan: null,
      ...patch,
    }),
  });

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** Claude Max with three windows (one Model-scoped), Codex reached, OpenCode with only a status. */
export const LIMITS = [
  limit({
    harness: "claude",
    kind: "five-hour",
    windowMinutes: 300,
    usedPercent: 99.6,
    status: "warning",
    resetsAt: inHours(0.2),
    plan: "max-20x-enterprise-annual",
  }),
  limit({
    harness: "claude",
    kind: "weekly",
    windowMinutes: 10_080,
    usedPercent: 142,
    status: "reached",
    resetsAt: inHours(150),
    plan: "max-20x-enterprise-annual",
    weeklyPerSession: 0.31,
  }),
  limit({
    harness: "claude",
    kind: "weekly",
    scope: "claude-opus-5-5-20261001-long-context",
    windowMinutes: 10_080,
    usedPercent: 0,
    resetsAt: inHours(150),
    plan: "max-20x-enterprise-annual",
  }),
  limit({
    harness: "codex",
    kind: "five-hour",
    windowMinutes: 300,
    usedPercent: 100,
    status: "reached",
    resetsAt: inHours(4.9),
    plan: "pro",
  }),
  limit({
    harness: "opencode",
    kind: "requests-per-day",
    status: "warning",
    observedAt: ago(9_000),
  }),
];
