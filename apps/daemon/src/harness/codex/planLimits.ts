/**
 * Plan Limits from the app-server: a read when a session connects, then the
 * sparse `account/rateLimits/updated` notifications Codex sends during Turns.
 * Codex answers from its own sign-in; Polaris never sees a credential (ADR 0001).
 */
import { Effect, Option, Schema } from "effect";
import {
  type CodexLimitTracker,
  CodexRateLimitsRead,
  CodexRateLimitsUpdated,
} from "../limits/codex.ts";
import type { PlanLimitSink } from "../limits/PlanLimits.ts";
import type { RpcPayload } from "./protocol.ts";
import type { RpcConnection } from "./RpcConnection.ts";

export interface CodexPlanLimits {
  readonly sink: PlanLimitSink;
  /** Shared by every session of the driver, so sparse updates merge into one snapshot. */
  readonly tracker: CodexLimitTracker;
}

export const RATE_LIMITS_UPDATED = "account/rateLimits/updated";

const decodeRead = Schema.decodeUnknownOption(CodexRateLimitsRead);

const decodeUpdated = Schema.decodeUnknownOption(CodexRateLimitsUpdated);

const now = () => new Date().toISOString();

/** `account/rateLimits/read`; a failure (not signed in, an older Codex) only means no value. */
export const readRateLimits = (conn: RpcConnection, limits: CodexPlanLimits) =>
  conn.request("account/rateLimits/read", {}).pipe(
    Effect.map(decodeRead),
    Effect.tap((read) =>
      Effect.sync(() => {
        if (Option.isSome(read)) limits.sink.report(limits.tracker.onRead(read.value, now()));
      })
    ),
    Effect.ignore
  );

export const onRateLimitsUpdated = (limits: CodexPlanLimits) => (params: RpcPayload) => {
  const update = decodeUpdated(params);

  if (Option.isSome(update)) limits.sink.report(limits.tracker.onUpdated(update.value, now()));
};
