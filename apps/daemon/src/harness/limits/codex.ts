// Portions adapted from pingdotgg/t3code@ba79610 (MIT)
/**
 * Codex's Plan Limits, from what Codex itself exposes: the app-server's
 * `account/rateLimits/read` reply and sparse `account/rateLimits/updated`
 * notifications, and, with no app-server running, the `token_count` events
 * Codex writes to its own rollout logs.
 */
import { PlanLimit } from "@polaris/protocol";
import { Option, Predicate, Schema } from "effect";

const FIVE_HOURS = 300;

const DAY = 24 * 60;

const WEEK = 7 * DAY;

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

const Window = Schema.Struct({
  usedPercent: Schema.Number,
  windowDurationMins: Nullable(Schema.Number),
  resetsAt: Nullable(Schema.Number),
});

/** The fields of app-server's `RateLimitSnapshot` Polaris reads. */
export const RateLimitSnapshot = Schema.Struct({
  limitId: Nullable(Schema.String),
  limitName: Nullable(Schema.String),
  primary: Nullable(Window),
  secondary: Nullable(Window),
  planType: Nullable(Schema.String),
  rateLimitReachedType: Nullable(Schema.String),
});

export type RateLimitSnapshot = typeof RateLimitSnapshot.Type;

/** An `account/rateLimits/read` result. */
export const CodexRateLimitsRead = Schema.Struct({
  rateLimits: RateLimitSnapshot,
  rateLimitsByLimitId: Nullable(Schema.Record(Schema.String, Schema.NullOr(RateLimitSnapshot))),
});

export type CodexRateLimitsRead = typeof CodexRateLimitsRead.Type;

/** An `account/rateLimits/updated` notification: sparse, merged into the last read. */
export const CodexRateLimitsUpdated = Schema.Struct({ rateLimits: RateLimitSnapshot });

export type CodexRateLimitsUpdated = typeof CodexRateLimitsUpdated.Type;

/** The main allowance; other ids (a Model's own quota) become scoped limits. */
const MAIN_LIMIT = "codex";

/** `primary`/`secondary` are positions: 300 and 10080 minutes on paid plans, monthly on free and go. */
const kindFor = (minutes: number): string => {
  if (minutes === FIVE_HOURS) return "five-hour";

  if (minutes === DAY) return "daily";

  if (minutes === WEEK) return "weekly";

  if (minutes >= 28 * DAY) return "monthly";

  return `${minutes}-minute`;
};

const isoFromEpochSeconds = (seconds: number | null | undefined): string | null =>
  Predicate.isNotNullish(seconds) && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;

/** Every window in one snapshot. */
export const fromSnapshot = (
  snapshot: RateLimitSnapshot,
  observedAt: string
): ReadonlyArray<PlanLimit> => {
  const limitId = snapshot.limitId ?? MAIN_LIMIT;
  const scope = limitId === MAIN_LIMIT ? null : (snapshot.limitName ?? limitId);
  const monthly = snapshot.planType === "free" || snapshot.planType === "go";

  const positions = [
    [snapshot.primary, monthly ? 30 * DAY : FIVE_HOURS],
    [snapshot.secondary, WEEK],
  ] as const;

  return positions.flatMap(([window, fallback]) => {
    if (!window || !Number.isFinite(window.usedPercent)) return [];
    const minutes = window.windowDurationMins ?? fallback;
    const usedPercent = Math.min(100, Math.max(0, window.usedPercent));

    return [
      new PlanLimit({
        harness: "codex",
        kind: kindFor(minutes),
        scope,
        windowMinutes: minutes,
        usedPercent,
        status: usedPercent >= 100 ? "reached" : "ok",
        resetsAt: isoFromEpochSeconds(window.resetsAt),
        observedAt,
        plan: snapshot.planType ?? null,
      }),
    ];
  });
};

/**
 * The last snapshot per limit id, shared by every Codex session on the Host.
 * Updates are sparse: a field an update leaves null keeps its last value.
 */
export class CodexLimitTracker {
  private readonly snapshots = new Map<string, RateLimitSnapshot>();

  private merge(update: RateLimitSnapshot): RateLimitSnapshot {
    const id = update.limitId ?? MAIN_LIMIT;
    const previous = this.snapshots.get(id);

    const merged: RateLimitSnapshot = previous
      ? {
          limitId: id,
          limitName: update.limitName ?? previous.limitName,
          primary: update.primary ?? previous.primary,
          secondary: update.secondary ?? previous.secondary,
          planType: update.planType ?? previous.planType,
          rateLimitReachedType: update.rateLimitReachedType ?? previous.rateLimitReachedType,
        }
      : update;

    this.snapshots.set(id, merged);

    return merged;
  }

  /** An `account/rateLimits/read` result. */
  onRead(result: CodexRateLimitsRead, observedAt: string): ReadonlyArray<PlanLimit> {
    const byId = Object.values(result.rateLimitsByLimitId ?? {}).filter(Predicate.isNotNull);
    const snapshots = byId.length > 0 ? byId : [result.rateLimits];

    // A read is complete: it replaces what earlier updates built up.
    for (const s of snapshots) this.snapshots.delete(s.limitId ?? MAIN_LIMIT);

    return snapshots.flatMap((s) => fromSnapshot(this.merge(s), observedAt));
  }

  /** An `account/rateLimits/updated` notification. */
  onUpdated(update: CodexRateLimitsUpdated, observedAt: string): ReadonlyArray<PlanLimit> {
    return fromSnapshot(this.merge(update.rateLimits), observedAt);
  }
}

// ---------------------------------------------------------------------------
// Rollout logs

const RolloutWindow = Schema.Struct({
  used_percent: Schema.Number,
  window_minutes: Nullable(Schema.Number),
  resets_at: Nullable(Schema.Number),
});

/** A rollout line: `{timestamp, type: "event_msg", payload: {type: "token_count", rate_limits}}`. */
const TokenCountLine = Schema.fromJsonString(
  Schema.Struct({
    timestamp: Schema.String,
    payload: Schema.Struct({
      type: Schema.Literal("token_count"),
      rate_limits: Schema.Struct({
        limit_id: Nullable(Schema.String),
        limit_name: Nullable(Schema.String),
        primary: Nullable(RolloutWindow),
        secondary: Nullable(RolloutWindow),
        plan_type: Nullable(Schema.String),
        rate_limit_reached_type: Nullable(Schema.String),
      }),
    }),
  })
);

const decodeTokenCount = Schema.decodeUnknownOption(TokenCountLine);

const toWindow = (w: typeof RolloutWindow.Type | null | undefined) =>
  w
    ? { usedPercent: w.used_percent, windowDurationMins: w.window_minutes, resetsAt: w.resets_at }
    : null;

/** The Plan Limits in the last `token_count` event of a rollout file's text; empty if none. */
export const fromRolloutText = (text: string): ReadonlyArray<PlanLimit> => {
  let end = text.length;

  while (end > 0) {
    const start = text.lastIndexOf("\n", end - 1);
    const line = text.slice(start + 1, end);
    end = Math.max(start, 0);

    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    const decoded = decodeTokenCount(line);

    if (Option.isNone(decoded)) continue;
    const { timestamp, payload } = decoded.value;
    const r = payload.rate_limits;

    return fromSnapshot(
      {
        limitId: r.limit_id,
        limitName: r.limit_name,
        primary: toWindow(r.primary),
        secondary: toWindow(r.secondary),
        planType: r.plan_type,
        rateLimitReachedType: r.rate_limit_reached_type,
      },
      new Date(timestamp).toISOString()
    );
  }

  return [];
};
