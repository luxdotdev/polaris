/**
 * Usage and Plan Limits (CONTEXT.md). The Daemon reports tokens, and cost only
 * where the Harness reported one; Clients estimate the rest from a price list
 * and label it as an estimate. Both come only from what the Harness exposes or
 * writes on the Host, never from provider credentials (ADR 0001).
 */
import { Effect, Schema } from "effect";
import { Timestamp } from "./domain.ts";
import { HarnessKind } from "./harnesses.ts";
import { SessionId } from "./ids.ts";
import { addedNullable, ModelId } from "./models.ts";

/** Tokens, normalized across Harnesses: the four kinds a price list prices apart. */
export class TokenCounts extends Schema.Class<TokenCounts>("TokenCounts")({
  /** Input tokens neither read from nor written to the prompt cache. */
  input: Schema.Int,
  cacheRead: Schema.Int,
  cacheWrite: Schema.Int,
  /** Output tokens, reasoning included. */
  output: Schema.Int,
  /** The part of `output` spent on reasoning, where the Harness reports it (else 0). */
  reasoning: Schema.Int,
  /**
   * The part of `cacheWrite` cached for an hour rather than five minutes
   * (Claude), which is priced higher. Added later: absent decodes as 0.
   */
  cacheWrite1h: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
}) {}

/**
 * The tokens of the requests whose prompt (input, cached or not) was longer
 * than `above`. Vendors price such a request entirely at long-context rates:
 * above 200k for some Claude Models, above 272k for OpenAI's.
 */
export class LongContextTokens extends Schema.Class<LongContextTokens>("LongContextTokens")({
  above: Schema.Int,
  tokens: TokenCounts,
}) {}

/** A cost the Harness itself reported, and the tokens it covers. */
export class ReportedCost extends Schema.Class<ReportedCost>("ReportedCost")({
  /** A subset of the bucket's tokens; Clients estimate the cost of the rest. */
  tokens: TokenCounts,
  usd: Schema.Number,
}) {}

/**
 * Usage in one hour, for one Harness, Model and Agent Session. Its key is
 * (`hour`, `harness`, `model`, `sessionId`): a newer bucket with the same key
 * replaces the older one.
 */
export class UsageBucket extends Schema.Class<UsageBucket>("UsageBucket")({
  /** The start of the hour, UTC. */
  hour: Timestamp,
  harness: HarnessKind,
  model: ModelId,
  /** The Agent Session the Usage ran in; null for Harness work outside Polaris. */
  sessionId: Schema.NullOr(SessionId),
  tokens: TokenCounts,
  /** Null when the Harness reported no cost for any of it. */
  reportedCost: Schema.NullOr(ReportedCost),
  /**
   * Long-context subsets of `tokens`, one per threshold the Daemon tracks
   * (200k and 272k), each counting only its long requests. Absent decodes as none.
   */
  longContext: Schema.Array(LongContextTokens).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
}) {}

/** Added later: absent (an older Daemon, which always answered caught up) decodes as false. */
const indexingFlag = Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false)));

export class UsageReport extends Schema.Class<UsageReport>("UsageReport")({
  buckets: Schema.Array(UsageBucket),
  /** When the Daemon's index of the Harness logs last caught up; null before its first pass. */
  indexedAt: Schema.NullOr(Timestamp),
  /**
   * The Daemon is still reading logs (a first pass over large logs takes a
   * while): the buckets are what it has indexed so far. `usage.watch` sends a
   * `UsageChanged` whose `indexing` is false when it is done; query again then.
   */
  indexing: indexingFlag,
}) {}

/**
 * A Plan Limit's window as the Harness reports it: `five-hour` and `weekly`
 * today. Open, so a window a newer Daemon reports still decodes.
 */
export const PlanLimitKind = Schema.String;

export type PlanLimitKind = typeof PlanLimitKind.Type;

/** `warning` when the Harness says the limit is near, `reached` when it refuses work. */
export const PlanLimitStatus = Schema.Literals(["ok", "warning", "reached"]);

export type PlanLimitStatus = typeof PlanLimitStatus.Type;

/**
 * The last known value of one Plan Limit window. Its key is (`harness`,
 * `kind`, `scope`). Clients show its age (from `observedAt`) when no Agent
 * Session of that Harness is running to refresh it.
 */
export class PlanLimit extends Schema.Class<PlanLimit>("PlanLimit")({
  harness: HarnessKind,
  kind: PlanLimitKind,
  /** The Model (or family) the window is limited to, as the Harness names it; null for the whole plan. */
  scope: Schema.NullOr(Schema.String),
  /** The window's length, when the Harness says (300 for five hours). */
  windowMinutes: Schema.NullOr(Schema.Int),
  /** How much of the window is used, 0–100; null when the Harness reported only a status. */
  usedPercent: Schema.NullOr(Schema.Number),
  status: PlanLimitStatus,
  resetsAt: Schema.NullOr(Timestamp),
  /** When the Harness reported this value. */
  observedAt: Timestamp,
  /** The subscription as the Harness names it (`max`, `pro`, `plus`), when reported. */
  plan: Schema.NullOr(Schema.String),
  /**
   * On the whole-plan weekly window: the median share of it one full 5-hour
   * window used lately, from the Daemon's history of readings; null until it
   * has seen three finished 5-hour windows, and on every other window.
   */
  weeklyPerSession: addedNullable(Schema.Number).pipe(
    Schema.withConstructorDefault(Effect.succeed(null))
  ),
}) {}

/**
 * What `usage.watch` sends. Live only, not persisted or sequenced: Usage is a
 * rebuildable index over the Harness logs, never events in the store.
 */
export const UsageStreamItem = Schema.TaggedUnion({
  /** Buckets whose totals changed, each replacing the Client's bucket with the same key. */
  UsageChanged: {
    buckets: Schema.Array(UsageBucket),
    indexedAt: Timestamp,
    /**
     * A pass that takes a while is announced with `indexing` true and no
     * buckets. It ends with `indexing` false and, since it may have changed
     * thousands of buckets, none listed: query again for what it indexed.
     * A short pass is never announced and lists the buckets it changed.
     */
    indexing: indexingFlag,
  },
  /** A Plan Limit's latest value. On subscribe, the Daemon first sends every one it knows. */
  PlanLimitChanged: { limit: PlanLimit },
});

export type UsageStreamItem = typeof UsageStreamItem.Type;

/** `a` + `b`, kind by kind. */
export const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts =>
  new TokenCounts({
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  });

/** No tokens at all: the start of a sum. */
export const noTokens = new TokenCounts({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  cacheWrite1h: 0,
});

/**
 * The tokens in `buckets`: all of them, and the part that ran in Agent
 * Sessions (through Polaris). The rest is Harness work outside Polaris.
 */
export const usageShare = (
  buckets: ReadonlyArray<UsageBucket>
): { readonly all: TokenCounts; readonly polaris: TokenCounts } =>
  buckets.reduce(
    (share, bucket) => ({
      all: addTokens(share.all, bucket.tokens),
      polaris: bucket.sessionId === null ? share.polaris : addTokens(share.polaris, bucket.tokens),
    }),
    { all: noTokens, polaris: noTokens }
  );
