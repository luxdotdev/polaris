/**
 * Which failed Turns stopped at a usage limit, so the session goes Limited rather than Failed.
 * The text reading is K-ENG's capacity classifier, without provider overload.
 */
import type { HarnessKind, PlanLimit, SessionId } from "@polaris/protocol";
import { capacityResetsAt, classifyFailure } from "../constellation/failureKind.ts";
import type { ReadModel } from "../store/model.ts";

/** Capacity text that is a provider's momentary overload, not a limit with a reset: Retry fits. */
const OVERLOAD = /\b(overloaded|at capacity|try a different model|server_error|529)\b/i;

/** Newer Claude Code words a reached plan window this way; K-ENG's classifier predates it. */
const HIT_LIMIT = /\bhit your (usage )?limit\b/i;

export interface UsageLimit {
  readonly resetsAt: string | null;
}

/** True for text that names a usage limit (not an overload). */
export const namesUsageLimit = (error: string | null): boolean =>
  error !== null &&
  (HIT_LIMIT.test(error) || (classifyFailure(error) === "capacity" && !OVERLOAD.test(error)));

/**
 * A failed Turn's usage limit: the driver's own report first, else the error text. The reset
 * is the driver's, else the latest reset among this Harness's reached Plan Limit windows.
 */
export const usageLimitOf = (input: {
  readonly error: string | null;
  readonly hint: UsageLimit | undefined;
  readonly harness: HarnessKind;
  readonly limits: ReadonlyArray<PlanLimit>;
  readonly now: string;
}): UsageLimit | null => {
  if (input.hint === undefined && !namesUsageLimit(input.error)) return null;

  return {
    resetsAt: input.hint?.resetsAt ?? capacityResetsAt(input.harness, input.limits, input.now),
  };
};

/** A Constellation worker's limit is the Lead's to handle: it settles failed (capacity), never Limited. */
export const isWorker = (model: ReadModel, sessionId: SessionId): boolean =>
  [...model.constellations.values()].some(
    (record) =>
      record.graph.leadSessionId !== sessionId &&
      record.graph.attempts.some((a) => a.sessionId === sessionId && a.state === "working")
  );
