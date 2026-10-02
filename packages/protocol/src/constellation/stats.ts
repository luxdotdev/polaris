import { Schema } from "effect";
import { HostId, Sequence, SessionId, Timestamp, TurnId } from "../ids.ts";
import { TokenCounts, UsageBucket } from "../usage.ts";
import { AttemptId, ConstellationId, Revision, TaskId } from "./domain.ts";

const ms = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const StatsUsage = Schema.Struct({
  tokens: TokenCounts,
  /** Only Harness-reported cost; Clients price the remaining buckets. */
  reportedUsd: Schema.Number,
  reportedTokens: TokenCounts,
  buckets: Schema.Array(UsageBucket),
});

export type StatsUsage = typeof StatsUsage.Type;

export const WorkerTimes = Schema.Struct({
  workingMs: Schema.NullOr(ms),
  idleMs: Schema.NullOr(ms),
  waitingForSlotMs: Schema.NullOr(ms),
  waitingOnLeaseMs: Schema.NullOr(ms),
  staleMs: Schema.NullOr(ms),
});

export type WorkerTimes = typeof WorkerTimes.Type;

export class ConstellationStats extends Schema.Class<ConstellationStats>("ConstellationStats")({
  constellationId: ConstellationId,
  revision: Revision,
  hostId: HostId,
  asOf: Timestamp,
  sequence: Sequence,
  wallClockMs: ms,
  usageIndexedAt: Schema.NullOr(Timestamp),
  indexing: Schema.Boolean,
  lead: Schema.Struct({
    wakeups: count,
    deliveredItems: count,
    coalescedItems: count,
    coalescingHitRate: Schema.NullOr(Schema.Number),
    meanTokensPerDigest: Schema.NullOr(Schema.Number),
    meanReportedUsdPerDigest: Schema.NullOr(Schema.Number),
    digests: Schema.Array(
      Schema.Struct({ turnId: TurnId, sessionId: SessionId, items: count, usage: StatsUsage })
    ),
  }),
  review: Schema.Struct({
    decidedClaims: count,
    meanClaimToReviewMs: Schema.NullOr(ms),
    medianClaimToReviewMs: Schema.NullOr(ms),
    acceptedFirstTime: count,
    firstClaimsReviewed: count,
    firstTimeAcceptanceRate: Schema.NullOr(Schema.Number),
    sendBacksByCause: Schema.Array(Schema.Struct({ cause: Schema.String, count })),
  }),
  workers: Schema.Struct({
    totals: WorkerTimes,
    attempts: Schema.Array(
      Schema.Struct({
        attemptId: AttemptId,
        taskId: TaskId,
        sessionId: SessionId,
        times: WorkerTimes,
      })
    ),
  }),
  usage: Schema.Struct({
    total: StatsUsage,
    perTask: Schema.Array(Schema.Struct({ taskId: TaskId, usage: StatsUsage })),
    perRole: Schema.Array(
      Schema.Struct({ role: Schema.Literals(["lead", "worker"]), usage: StatsUsage })
    ),
  }),
  coverage: Schema.Array(
    Schema.Struct({
      metric: Schema.String,
      reason: Schema.String,
      attemptId: Schema.NullOr(AttemptId),
    })
  ),
}) {}
