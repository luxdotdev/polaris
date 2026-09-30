// Portions adapted from pingdotgg/t3code@ba79610 (MIT)
/**
 * Claude Code's Plan Limits, from what the Agent SDK exposes: the experimental
 * `get_usage` reply (0–100 percentages, ISO resets) and `rate_limit_event`
 * messages during Turns (0–1 fractions, epoch-second resets). Callers decode
 * both with the schemas here, so an SDK change degrades to "no value".
 */
import { PlanLimit, type PlanLimitStatus } from "@polaris/protocol";
import { Predicate, Schema } from "effect";

const FIVE_HOURS = 300;

const WEEK = 7 * 24 * 60;

const NullableNumber = Schema.optional(Schema.NullOr(Schema.Number));

const NullableString = Schema.optional(Schema.NullOr(Schema.String));

const UsageWindow = Schema.Struct({ utilization: NullableNumber, resets_at: NullableString });

const UsageRow = Schema.Struct({
  kind: Schema.String,
  percent: NullableNumber,
  severity: NullableString,
  resets_at: NullableString,
  scope: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        model: Schema.optional(Schema.NullOr(Schema.Struct({ display_name: Schema.String }))),
      })
    )
  ),
});

const ModelScoped = Schema.Struct({
  display_name: Schema.String,
  utilization: NullableNumber,
  resets_at: NullableString,
});

/** The fields of `SDKControlGetUsageResponse` Polaris reads. */
export const ClaudeUsageResponse = Schema.Struct({
  subscription_type: NullableString,
  rate_limits_available: Schema.optional(Schema.Boolean),
  rate_limits: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        five_hour: Schema.optional(Schema.NullOr(UsageWindow)),
        seven_day: Schema.optional(Schema.NullOr(UsageWindow)),
        seven_day_opus: Schema.optional(Schema.NullOr(UsageWindow)),
        seven_day_sonnet: Schema.optional(Schema.NullOr(UsageWindow)),
        /** The server's own rows; classified on `kind`, never on a label. */
        limits: Schema.optional(Schema.NullOr(Schema.Array(UsageRow))),
        model_scoped: Schema.optional(Schema.NullOr(Schema.Array(ModelScoped))),
      })
    )
  ),
});

export type ClaudeUsageResponse = typeof ClaudeUsageResponse.Type;

const EventWindow = Schema.Struct({ utilization: NullableNumber, resetsAt: NullableNumber });

/** The fields of `SDKRateLimitEvent` Polaris reads. `unifiedWindows` is not in the SDK's types yet. */
export const ClaudeRateLimitEvent = Schema.Struct({
  type: Schema.Literal("rate_limit_event"),
  rate_limit_info: Schema.Struct({
    status: Schema.optional(Schema.String),
    rateLimitType: Schema.optional(Schema.String),
    utilization: NullableNumber,
    resetsAt: NullableNumber,
    unifiedWindows: Schema.optional(
      Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(EventWindow)))
    ),
  }),
});

export type ClaudeRateLimitEvent = typeof ClaudeRateLimitEvent.Type;

/** What one reading remembers for the next: the plan, and the overage-included Model's name. */
export interface ClaudeLimitContext {
  plan: string | null;
  /** `seven_day_overage_included` events don't name their Model; `get_usage` does. */
  overageIncluded: string | null;
}

export const emptyClaudeLimitContext = (): ClaudeLimitContext => ({
  plan: null,
  overageIncluded: null,
});

interface Window {
  readonly kind: string;
  readonly scope: string | null;
  readonly minutes: number;
}

const FIVE_HOUR: Window = { kind: "five-hour", scope: null, minutes: FIVE_HOURS };

const WEEKLY: Window = { kind: "weekly", scope: null, minutes: WEEK };

const weeklyFor = (model: string): Window => ({ kind: "weekly", scope: model, minutes: WEEK });

/** The SDK's window names; `overage` is spend, not a Plan Limit. */
const NAMED = new Map<string, Window>([
  ["five_hour", FIVE_HOUR],
  ["seven_day", WEEKLY],
  ["seven_day_opus", weeklyFor("Opus")],
  ["seven_day_sonnet", weeklyFor("Sonnet")],
]);

const ROW_WINDOWS = new Map<string, Window>([
  ["session", FIVE_HOUR],
  ["weekly_all", WEEKLY],
]);

const EVENT_STATUS = new Map<string, PlanLimitStatus>([
  ["allowed", "ok"],
  ["allowed_warning", "warning"],
  ["rejected", "reached"],
]);

const SEVERITY_STATUS = new Map<string, PlanLimitStatus>([
  ["warning", "warning"],
  ["critical", "warning"],
]);

const clamp = (percent: number) => Math.min(100, Math.max(0, percent));

const isoFromEpochSeconds = (seconds: number | null | undefined): string | null =>
  Predicate.isNotNullish(seconds) && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;

/** To the second: `get_usage` and the events report one reset with sub-second jitter. */
const isoFromString = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const ms = Date.parse(value);

  return Number.isFinite(ms) ? new Date(Math.round(ms / 1000) * 1000).toISOString() : null;
};

interface Reading {
  readonly window: Window;
  readonly usedPercent: number | null;
  readonly status: PlanLimitStatus;
  readonly resetsAt: string | null;
}

const toLimit = (reading: Reading, observedAt: string, plan: string | null) =>
  new PlanLimit({
    harness: "claude",
    kind: reading.window.kind,
    scope: reading.window.scope,
    windowMinutes: reading.window.minutes,
    usedPercent: reading.usedPercent,
    status: reading.usedPercent !== null && reading.usedPercent >= 100 ? "reached" : reading.status,
    resetsAt: reading.resetsAt,
    observedAt,
    plan,
  });

type UsageLimits = NonNullable<ClaudeUsageResponse["rate_limits"]>;

const usageReading = (
  window: Window | undefined,
  percent: number | null | undefined,
  resetsAt: string | null | undefined,
  severity: string | null | undefined = null
): Array<Reading> =>
  window && Predicate.isNotNullish(percent)
    ? [
        {
          window,
          usedPercent: clamp(percent),
          status: SEVERITY_STATUS.get(severity ?? "") ?? "ok",
          resetsAt: isoFromString(resetsAt),
        },
      ]
    : [];

/** The server's rows: `session`, `weekly_all` and `weekly_scoped` (per Model). */
const fromRows = (rows: NonNullable<UsageLimits["limits"]>): Array<Reading> =>
  rows.flatMap((row) => {
    const model = row.scope?.model?.display_name ?? null;

    const window =
      row.kind === "weekly_scoped" && model !== null ? weeklyFor(model) : ROW_WINDOWS.get(row.kind);

    return usageReading(window, row.percent, row.resets_at, row.severity);
  });

/** The named windows, for a CLI that sends no rows. */
const fromNamed = (limits: UsageLimits): Array<Reading> => [
  ...usageReading(FIVE_HOUR, limits.five_hour?.utilization, limits.five_hour?.resets_at),
  ...usageReading(WEEKLY, limits.seven_day?.utilization, limits.seven_day?.resets_at),
  ...usageReading(
    NAMED.get("seven_day_opus"),
    limits.seven_day_opus?.utilization,
    limits.seven_day_opus?.resets_at
  ),
  ...usageReading(
    NAMED.get("seven_day_sonnet"),
    limits.seven_day_sonnet?.utilization,
    limits.seven_day_sonnet?.resets_at
  ),
  ...(limits.model_scoped ?? []).flatMap((m) =>
    usageReading(weeklyFor(m.display_name), m.utilization, m.resets_at)
  ),
];

/** A `get_usage` reply; empty when plan limits don't apply (API key, Bedrock, Vertex). */
export const fromUsageResponse = (
  response: ClaudeUsageResponse,
  observedAt: string,
  context: ClaudeLimitContext
): ReadonlyArray<PlanLimit> => {
  const limits = response.rate_limits;

  context.plan = response.subscription_type ?? context.plan;
  context.overageIncluded = limits?.model_scoped?.[0]?.display_name ?? context.overageIncluded;

  if (response.rate_limits_available === false || !limits) return [];

  const readings =
    limits.limits && limits.limits.length > 0 ? fromRows(limits.limits) : fromNamed(limits);

  return readings.map((reading) => toLimit(reading, observedAt, context.plan));
};

const eventWindow = (name: string, context: ClaudeLimitContext): Window | undefined => {
  if (name !== "seven_day_overage_included") return NAMED.get(name);

  return context.overageIncluded === null ? undefined : weeklyFor(context.overageIncluded);
};

/**
 * A `rate_limit_event`: it names one window (`rateLimitType`) and its status,
 * and newer CLIs add every window's utilization (`unifiedWindows`).
 */
export const fromRateLimitEvent = (
  event: ClaudeRateLimitEvent,
  observedAt: string,
  context: ClaudeLimitContext
): ReadonlyArray<PlanLimit> => {
  const info = event.rate_limit_info;
  const windows = new Map<string, { utilization: number | null; resetsAt: number | null }>();

  for (const [name, w] of Object.entries(info.unifiedWindows ?? {}))
    if (w) windows.set(name, { utilization: w.utilization ?? null, resetsAt: w.resetsAt ?? null });

  const named = info.rateLimitType;

  if (named !== undefined)
    windows.set(named, {
      utilization: info.utilization ?? windows.get(named)?.utilization ?? null,
      resetsAt: info.resetsAt ?? windows.get(named)?.resetsAt ?? null,
    });

  return [...windows].flatMap(([name, w]) => {
    const window = eventWindow(name, context);
    const status = name === named ? (EVENT_STATUS.get(info.status ?? "") ?? "ok") : "ok";

    // Rounded to 0.01 %: `0.07 * 100` is 7.000000000000001, which would read as a change.
    const usedPercent =
      w.utilization === null ? null : clamp(Math.round(w.utilization * 1e4) / 100);

    // A window with neither a value nor a verdict says nothing.
    if (!window || (usedPercent === null && status === "ok")) return [];

    return [
      toLimit(
        { window, usedPercent, status, resetsAt: isoFromEpochSeconds(w.resetsAt) },
        observedAt,
        context.plan
      ),
    ];
  });
};
