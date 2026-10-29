import type { DomainEvent } from "@polaris/protocol";
import { Effect, Match } from "effect";
import { McpTokens } from "./tokens.ts";

/** Apply committed lifecycle events, including replay after restart; each step is idempotent. */
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
    Match.tag("ConstellationStarted", (e) =>
      tokens.advanceLeads(e.constellation.leadSessionId, e.constellationId)
    ),
    // A closed Constellation's Lead keeps its tools, to start the next one.
    Match.tag("ConstellationStateChanged", (e) =>
      Match.value(e.state).pipe(
        Match.when("archived", () =>
          Effect.andThen(
            tokens.revokeWorkers(e.constellationId),
            tokens.closeLeads(e.constellationId)
          )
        ),
        Match.when("completed", () => tokens.closeLeads(e.constellationId)),
        Match.orElse(() => Effect.void)
      )
    ),
    Match.orElse(() => Effect.void)
  );
});
