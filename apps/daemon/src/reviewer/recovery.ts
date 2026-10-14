import { DomainEvent, LayerRun, type RiskSummary } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { REVIEWER_MARKER, WALKTHROUGH_MARKER } from "./markers.ts";
import { ReviewerSessions } from "./sessions.ts";

export const RESTART_NOTE = "The daemon restarted during this review. Run the reviewer again.";

const abandonedEvents = (summary: RiskSummary): ReadonlyArray<DomainEvent> => [
  ...(["rules", "agent"] as const).flatMap((layer) => {
    const status = summary.layers[layer].status;

    return status === "running" || status === "pending"
      ? [
          DomainEvent.cases.RiskSummaryLayerChanged.make({
            summaryId: summary.id,
            layer,
            run: LayerRun.make({ status: "failed", note: RESTART_NOTE }),
          }),
        ]
      : [];
  }),
  DomainEvent.cases.RiskSummaryEnded.make({
    summaryId: summary.id,
    status: "failed",
    reviewer: summary.reviewer,
    cost: summary.cost,
    note: RESTART_NOTE,
  }),
];

/** Restore the policy's identities: the summaries' sessions, and any session a Reviewer or walkthrough prompt started. */
export const registerReviewerSessions = Effect.gen(function* () {
  const store = yield* EventStore;
  const sessions = yield* ReviewerSessions;
  const recovery = yield* store.review.recovery;

  for (const sessionId of recovery.sessions) yield* sessions.register(sessionId);
  const model = yield* store.model;

  for (const [sessionId, record] of model.sessions) {
    if (
      record.turns.some(
        (turn) =>
          turn.prompt.startsWith(REVIEWER_MARKER) || turn.prompt.startsWith(WALKTHROUGH_MARKER)
      )
    )
      yield* sessions.register(sessionId);
  }
});

/** Whether a restart left a Risk Summary or a walkthrough running, for the Reviewer to fail on start. */
export const needsReviewerStartup = Effect.gen(function* () {
  const store = yield* EventStore;
  const recovery = yield* store.review.recovery;

  return recovery.running.length > 0 || (yield* store.review.writingWalkthroughs()).length > 0;
});

/** Restore the policy's identities; a restarted Daemon never resumes a summary worker. */
export const recoverReviewer = Effect.gen(function* () {
  const store = yield* EventStore;
  yield* registerReviewerSessions;
  const recovery = yield* store.review.recovery;
  const events = recovery.running.flatMap(abandonedEvents);

  if (events.length > 0)
    yield* store
      .commit({ commandId: null, decide: () => Effect.succeed(events) })
      .pipe(Effect.orDie);
});
