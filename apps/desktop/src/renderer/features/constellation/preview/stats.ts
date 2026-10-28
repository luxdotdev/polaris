/**
 * `constellation.stats` for the previews, as main returns it (C1-M's shape, each bucket priced):
 * stale time not recorded until L lands, one Attempt without slot history, Usage indexing.
 */
import {
  AttemptId,
  ConstellationStats,
  HostId,
  ModelId,
  Sequence,
  TaskId,
  TokenCounts,
  TurnId,
  UsageBucket,
} from "@polaris/protocol";
import type { ConstellationStatsView } from "../../../../shared/api.ts";
import { CONSTELLATION, LEAD, worker } from "./graph.ts";

const MINUTE = 60_000;

const counts = (input: number, output: number, cacheRead = input * 6) =>
  new TokenCounts({
    input,
    cacheRead,
    cacheWrite: Math.round(input / 2),
    output,
    reasoning: Math.round(output / 3),
    cacheWrite1h: 0,
  });

const bucket = (model: string, input: number, output: number) =>
  new UsageBucket({
    hour: new Date(Date.now() - 60 * MINUTE).toISOString(),
    harness: model.startsWith("gpt") ? "codex" : "claude",
    model: ModelId.make(model),
    sessionId: null,
    tokens: counts(input, output),
    reportedCost: null,
    longContext: [],
  });

/** One section's Usage with main's estimate per bucket; `unpriced` adds a bucket with no price. */
const priced = (
  input: number,
  output: number,
  usd: number,
  unpriced = 0,
  model = "gpt-6.1-sol"
) => {
  const extra = unpriced === 0 ? [] : [bucket("no-price-model", unpriced, 0)];

  return {
    tokens: counts(input, output),
    reportedUsd: 0,
    reportedTokens: counts(0, 0, 0),
    buckets: [bucket(model, input, output), ...extra],
    estimates: [
      { estimatedUsd: usd, unpricedTokens: 0 },
      ...extra.map(() => ({ estimatedUsd: 0, unpricedTokens: unpriced })),
    ],
  };
};

/** The Daemon's StatsUsage for a section: the same buckets, without main's estimates. */
const raw = ({ estimates: _estimates, ...usage }: ReturnType<typeof priced>) => usage;

const times = (
  working: number | null,
  idle: number | null,
  slot: number | null,
  lease: number | null
) => ({
  workingMs: working === null ? null : working * MINUTE,
  idleMs: idle === null ? null : idle * MINUTE,
  waitingForSlotMs: slot === null ? null : slot * MINUTE,
  waitingOnLeaseMs: lease === null ? null : lease * MINUTE,
  staleMs: null,
});

const TOTAL = priced(182_000, 41_000, 3.33, 12_000);

/** Each update turn's (input, output, usd), uneven like a real run. */
const DIGESTS = (
  [
    [38, 3, 0.37],
    [22, 2, 0.21],
    [41, 4, 0.4],
    [18, 1, 0.16],
    [56, 6, 0.58],
    [30, 2, 0.29],
    [27, 3, 0.26],
    [64, 7, 0.66],
    [35, 3, 0.34],
    [20, 2, 0.19],
    [44, 4, 0.43],
    [31, 3, 0.3],
  ] as const
).map(([input, output, usd]) => priced(input * 1000, output * 1000, usd, 0, "claude-opus-5-5"));

const DIGEST_ITEMS = [3, 1, 4, 1, 5, 2, 2, 6, 3, 1, 3, 2];

const PER_TASK = (
  [
    ["A1", 18_000, 4_100, 0.42],
    ["A2", 22_000, 5_300, 0.51],
    ["B1", 31_000, 7_900, 0.73],
    ["B2", 36_000, 9_100, 0.84],
    ["B3", 12_000, 2_400, 0.22],
  ] as const
).map(([taskId, input, output, usd]) => ({
  taskId: TaskId.make(taskId),
  usage: priced(input, output, usd),
}));

const ROLES = [
  { role: "lead" as const, usage: priced(63_000, 12_000, 0.61, 0, "claude-opus-5-5") },
  { role: "worker" as const, usage: priced(119_000, 29_000, 2.72) },
];

const COVERAGE = [
  {
    metric: "workers.staleMs",
    attemptId: null,
    reason:
      "Offline intervals are not recorded yet; L stale/fresh Constellation events will unlock this metric.",
  },
  {
    metric: "workers.waitingForSlotMs",
    attemptId: AttemptId.make("att-B4-1"),
    reason:
      "No local __workers queue/grant history for this Attempt; legacy or remote slot time is unknown.",
  },
  {
    metric: "usage",
    attemptId: null,
    reason: "Usage is local to this Host; remote worker Usage must be joined by the Client.",
  },
];

export const statsFixture = (revision: number): ConstellationStatsView => ({
  stats: new ConstellationStats({
    constellationId: CONSTELLATION,
    revision,
    hostId: HostId.make("h-studio"),
    asOf: new Date().toISOString(),
    sequence: Sequence.make(900),
    wallClockMs: 4 * 60 * MINUTE + 12 * MINUTE,
    usageIndexedAt: new Date().toISOString(),
    indexing: true,
    lead: {
      wakeups: 12,
      deliveredItems: 33,
      coalescedItems: 14,
      coalescingHitRate: 0.61,
      meanTokensPerDigest: 41_000,
      meanReportedUsdPerDigest: null,
      digests: DIGESTS.map((d, i) => ({
        turnId: TurnId.make(`t-lead-digest-${i + 1}`),
        sessionId: LEAD,
        items: DIGEST_ITEMS[i] ?? 1,
        usage: raw(d),
      })),
    },
    review: {
      decidedClaims: 5,
      meanClaimToReviewMs: 7 * MINUTE,
      medianClaimToReviewMs: 4 * MINUTE,
      acceptedFirstTime: 3,
      firstClaimsReviewed: 4,
      firstTimeAcceptanceRate: 0.75,
      sendBacksByCause: [
        { cause: "SentBack", count: 1 },
        { cause: "MergeConflict", count: 1 },
      ],
    },
    workers: {
      totals: times(212, 38, 14, 9),
      attempts: [
        {
          attemptId: AttemptId.make("att-B4-1"),
          taskId: TaskId.make("B4"),
          sessionId: worker("B4"),
          times: times(null, null, null, null),
        },
      ],
    },
    usage: {
      total: raw(TOTAL),
      perTask: PER_TASK.map((t) => ({ taskId: t.taskId, usage: raw(t.usage) })),
      perRole: ROLES.map((r) => ({ role: r.role, usage: raw(r.usage) })),
    },
    coverage: COVERAGE,
  }),
  usage: { total: TOTAL, perTask: PER_TASK, perRole: ROLES, perDigest: DIGESTS },
  pricesFetchedAt: new Date().toISOString(),
});
