/** The Reviewer's own sessions, whose approvals the read-only policy answers. */
import type { SessionId } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";

export class ReviewerSessions extends Context.Service<
  ReviewerSessions,
  {
    readonly register: (sessionId: SessionId) => Effect.Effect<void>;
    readonly has: (sessionId: SessionId) => boolean;
  }
>()("polaris/daemon/reviewer/ReviewerSessions") {
  static readonly layer = Layer.sync(ReviewerSessions, () => {
    const sessions = new Set<SessionId>();

    return ReviewerSessions.of({
      register: (sessionId) => Effect.sync(() => void sessions.add(sessionId)),
      has: (sessionId) => sessions.has(sessionId),
    });
  });
}
