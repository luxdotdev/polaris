/**
 * `constellation.stats` for the previews, as main returns it (C1-M's shape, priced): stale time
 * not recorded until L lands, one Attempt without slot history, and usage still indexing.
 */
import {
  AttemptId,
  ConstellationStats,
  HostId,
  Sequence,
  TaskId,
  TokenCounts,
  TurnId,
  UsageBucket,
} from "@polaris/protocol";
import type { ConstellationStatsView, StatsCost } from "../../../../shared/api.ts";
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

const NO_BUCKETS: ReadonlyArray<UsageBucket> = [];

const usage = (input: number, output: number, reportedUsd: number) => ({
  tokens: counts(input, output),
  reportedUsd,
  reportedTokens: counts(0, 0, 0),
  buckets: NO_BUCKETS,
});

const cost = (usd: number, unpricedTokens = 0): StatsCost => ({
  usd,
  estimatedUsd: usd,
  unpricedTokens,
});

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

const PER_TASK = [
  ["A1", 18_000, 4_100, 0.42],
  ["A2", 22_000, 5_300, 0.51],
  ["B1", 31_000, 7_900, 0.73],
  ["B2", 36_000, 9_100, 0.84],
  ["B3", 12_000, 2_400, 0.22],
] as const;

export const statsFixture = (revision: number): ConstellationStatsView => {
  const stats = new ConstellationStats({
    constellationId: CONSTELLATION,
    revision,
    hostId: HostId.make("h-studio"),
    asOf: new Date().toISOString(),
    sequence: Sequence.make(900),
    wallClockMs: 4 * 60 * MINUTE + 12 * MINUTE,
    usageIndexedAt: new Date().toISOString(),
    indexing: true,
    lead: {
      wakeups: 9,
      deliveredItems: 23,
      coalescedItems: 14,
      coalescingHitRate: 0.61,
      meanTokensPerDigest: 41_000,
      meanReportedUsdPerDigest: null,
      digests: [
        {
          turnId: TurnId.make("t-lead-digest"),
          sessionId: LEAD,
          items: 3,
          usage: usage(38_000, 3_000, 0),
        },
      ],
    },
    review: {
      decidedClaims: 5,
      meanClaimToReviewMs: 7 * MINUTE,
      medianClaimToReviewMs: 4 * MINUTE,
      acceptedFirstTime: 3,
      firstClaimsReviewed: 4,
      firstTimeAcceptanceRate: 0.75,
      sendBacksByCause: [
        { cause: "sent back", count: 1 },
        { cause: "merge conflict", count: 1 },
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
      total: usage(182_000, 41_000, 1.12),
      perTask: PER_TASK.map(([taskId, input, output, reported]) => ({
        taskId: TaskId.make(taskId),
        usage: usage(input, output, reported),
      })),
      perRole: [
        { role: "lead", usage: usage(63_000, 12_000, 0.61) },
        { role: "worker", usage: usage(119_000, 29_000, 2.72) },
      ],
    },
    coverage: [
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
    ],
  });

  return {
    stats,
    cost: {
      total: cost(3.33, 12_000),
      perTask: PER_TASK.map(([, , , reported]) => cost(reported)),
      perRole: [cost(0.61), cost(2.72)],
      perDigest: [cost(0.37)],
    },
    pricesFetchedAt: new Date().toISOString(),
  };
};
