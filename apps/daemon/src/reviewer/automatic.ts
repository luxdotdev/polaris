/** The Risk Summaries that start without a Client asking: after a Turn, on acceptance, on new commits. */
import {
  DomainEvent,
  type ReviewCheckout,
  ReviewSubject,
  type SessionId,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import { EventStore } from "../store/EventStore.ts";
import type { RunRequest } from "./run.ts";
import { ReviewerSessions } from "./sessions.ts";

/** What starts a Risk Summary without a Client asking, for one committed event. */
export const automaticRun = (
  event: DomainEvent,
  checkoutOf: (id: ReviewCheckout["id"]) => ReviewCheckout | undefined,
  workspaceOfSession: (id: SessionId) => WorkspaceId | null
): RunRequest | null =>
  DomainEvent.matchOrElse(
    event,
    {
      TurnEnded: ({ turn }): RunRequest | null => {
        const workspaceId = workspaceOfSession(turn.sessionId);

        return workspaceId === null || turn.status === "working"
          ? null
          : {
              workspaceId,
              subject: ReviewSubject.cases.SessionTurns.make({
                sessionId: turn.sessionId,
                firstTurnId: turn.id,
                lastTurnId: turn.id,
              }),
              checkoutId: null,
              since: null,
              refresh: false,
              context: null,
              rulesOnly: true,
            };
      },
      TurnsAccepted: ({ sessionId, throughTurnId }): RunRequest | null => {
        const workspaceId = workspaceOfSession(sessionId);

        return workspaceId === null
          ? null
          : {
              workspaceId,
              subject: ReviewSubject.cases.SessionTurns.make({
                sessionId,
                firstTurnId: null,
                lastTurnId: throughTurnId,
              }),
              checkoutId: null,
              since: null,
              refresh: false,
              context: null,
            };
      },
      ReviewCheckoutChanged: ({ checkout }): RunRequest | null => {
        const known = checkoutOf(checkout.id) ?? checkout;

        const moved =
          known.state === "ready" &&
          known.reviewedHead !== null &&
          known.head !== null &&
          known.head !== known.reviewedHead;

        return moved && Predicate.isTagged(known.subject, "PullRequest")
          ? {
              workspaceId: known.workspaceId,
              subject: known.subject,
              checkoutId: known.id,
              since: known.reviewedHead,
              refresh: false,
              context: null,
            }
          : null;
      },
    },
    () => null
  );

/** Follows the store in the background from now on and hands every automatic run to `start`. */
export const followAutomatic = Effect.fnUntraced(function* (
  start: (request: RunRequest) => Effect.Effect<void>
) {
  const store = yield* EventStore;
  const sessions = yield* ReviewerSessions;

  const live = yield* store.subscribe({
    filter: (item) =>
      Predicate.isTagged(item, "Event") &&
      (DomainEvent.guards.TurnsAccepted(item.envelope.event) ||
        DomainEvent.guards.TurnEnded(item.envelope.event) ||
        DomainEvent.guards.ReviewCheckoutChanged(item.envelope.event)),
  });

  yield* Effect.forkScoped(
    Stream.runForEach(live, (item) =>
      Effect.gen(function* () {
        if (!Predicate.isTagged(item, "Event")) return;
        const model = yield* store.model;

        const request = automaticRun(
          item.envelope.event,
          (id) => model.reviewCheckouts.get(id),
          (id) => (sessions.has(id) ? null : (model.sessions.get(id)?.session.workspaceId ?? null))
        );

        if (request !== null) yield* start(request);
      })
    )
  );
});
