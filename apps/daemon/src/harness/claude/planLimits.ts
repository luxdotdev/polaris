/**
 * Plan Limits from the Agent SDK: `rate_limit_event` messages during Turns, and
 * the experimental `get_usage` call when a session opens and, at most every few
 * minutes, after a Turn. The CLI answers from its own sign-in (ADR 0001).
 */
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Option, Predicate, Schema } from "effect";
import {
  type ClaudeLimitContext,
  ClaudeRateLimitEvent,
  ClaudeUsageResponse,
  fromRateLimitEvent,
  fromUsageResponse,
} from "../limits/claude.ts";
import type { PlanLimitSink } from "../limits/PlanLimits.ts";

/** How often a Turn's end may ask `get_usage` again; the events cover the main windows between. */
export const USAGE_REFRESH_MS = 5 * 60_000;

export interface ClaudePlanLimits {
  readonly sink: PlanLimitSink;
  /** Shared by every session of the driver: the plan and scoped window names `get_usage` taught it. */
  readonly context: ClaudeLimitContext;
}

type UsageQuery = Pick<Query, "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET">;

const decodeUsage = Schema.decodeUnknownOption(ClaudeUsageResponse);

const decodeEvent = Schema.decodeUnknownOption(ClaudeRateLimitEvent);

/** One session's reader; `now` is injectable for tests. */
export const claudePlanLimitReader = (
  limits: ClaudePlanLimits,
  query: UsageQuery,
  now: () => number = Date.now
) => {
  let lastRead = Number.NEGATIVE_INFINITY;
  const at = () => new Date(now()).toISOString();

  const read = () => {
    // The capability check: the API is experimental and may disappear in any SDK release.
    if (!Predicate.isFunction(query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET))
      return;
    lastRead = now();

    void query
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      .then(
        (response) => {
          const usage = decodeUsage(response);

          if (Option.isSome(usage))
            limits.sink.report(fromUsageResponse(usage.value, at(), limits.context));
        },
        () => {}
      );
  };

  return {
    /** Ask `get_usage` now (the session just opened). */
    read,
    /** After a Turn: ask again only if the last answer is older than `USAGE_REFRESH_MS`. */
    refresh: () => {
      if (now() - lastRead >= USAGE_REFRESH_MS) read();
    },
    onMessage: (message: SDKMessage) => {
      if (message.type !== "rate_limit_event") return;
      const event = decodeEvent(message);

      if (Option.isSome(event))
        limits.sink.report(fromRateLimitEvent(event.value, at(), limits.context));
    },
  };
};
