/**
 * The Reviewer's cost line and Plan Limit note (ENG-229). Its tokens are the
 * Usage of its own Agent Session, so they count in Usage and Plan Limits like
 * any session's; this only reads them back.
 */
import {
  HARNESS_CATALOGUE,
  type HarnessKind,
  type PlanLimit,
  ReviewCost,
  type SessionId,
} from "@polaris/protocol";
import { Effect, Option } from "effect";
import { UsageIndex } from "../usage/index.ts";
import type { UsageHarness } from "../usage/indexer.ts";

const usageHarness = (harness: HarnessKind): UsageHarness | null =>
  harness === "claude" || harness === "codex" ? harness : null;

/** Tokens and reported cost of a session's Usage since `from`; null without a Usage index. */
export const reviewerCost = (harness: HarnessKind, sessionId: SessionId, from: string) =>
  Effect.gen(function* () {
    const usage = yield* Effect.serviceOption(UsageIndex);
    const indexed = usageHarness(harness);

    if (Option.isNone(usage) || indexed === null) return null;
    yield* usage.value.refresh([indexed]);

    const report = yield* usage.value.query({
      from,
      to: new Date(Date.now() + 60_000).toISOString(),
      harness,
      sessionId,
    });

    let tokens = 0;
    let usd = 0;
    let priced = false;

    for (const bucket of report.buckets) {
      const t = bucket.tokens;
      tokens += t.input + t.cacheRead + t.cacheWrite + t.output;

      if (bucket.reportedCost !== null) {
        usd += bucket.reportedCost.usd;
        priced = true;
      }
    }

    return tokens === 0 ? null : ReviewCost.make({ tokens, costUsd: priced ? usd : null });
  });

const harnessName = (harness: HarnessKind) =>
  HARNESS_CATALOGUE.find((entry) => entry.kind === harness)?.name ?? harness;

/** "Codex is near a Plan Limit…" when a window of the Harness is near or at its limit. */
export const planLimitNote = (
  harness: HarnessKind,
  limits: ReadonlyArray<PlanLimit>
): string | null => {
  const tight = limits.filter((limit) => limit.harness === harness && limit.status !== "ok");

  if (tight.length === 0) return null;
  const reached = tight.some((limit) => limit.status === "reached");

  return `${harnessName(harness)} is ${reached ? "at" : "near"} a Plan Limit. The review still ran; pick a cheaper Model for the Reviewer in Settings if you need to.`;
};

/** The note for the Reviewer's Harness now, from the Usage index's known limits. */
export const currentPlanLimitNote = (harness: HarnessKind) =>
  Effect.gen(function* () {
    const usage = yield* Effect.serviceOption(UsageIndex);

    if (Option.isNone(usage)) return null;

    return planLimitNote(harness, yield* usage.value.planLimits);
  });
