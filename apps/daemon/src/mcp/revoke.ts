import type { DomainEvent } from "@polaris/protocol";
import { Effect, Match } from "effect";
import { McpTokens } from "./tokens.ts";

/** Apply committed lifecycle events, including replay after restart; revocation is idempotent. */
export const revokeMcpBindings = Effect.fn("revokeMcpBindings")(function* (event: DomainEvent) {
  const tokens = yield* McpTokens;
  yield* Match.value(event).pipe(
    Match.tag("AttemptAccepted", (e) => tokens.revokeAttempt(e.attemptId)),
    Match.tag("AttemptRejected", (e) => tokens.revokeAttempt(e.attemptId)),
    Match.tag("AttemptSettled", (e) => tokens.revokeAttempt(e.attemptId)),
    Match.tag("LeadChanged", (e) => tokens.revokeSession(e.from)),
    Match.tag("SessionStateChanged", (e) =>
      e.state === "archived" ? tokens.revokeSession(e.sessionId) : Effect.void
    ),
    Match.tag("ConstellationStateChanged", (e) =>
      e.state === "archived" ? tokens.revokeConstellation(e.constellationId) : Effect.void
    ),
    Match.orElse(() => Effect.void)
  );
});
