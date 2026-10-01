import { DomainEvent, LayerRun, type RiskSummary } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { REVIEWER_MARKER } from "./prompt.ts";
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

/** Restore the policy's identities; a restarted Daemon never resumes a summary worker. */
export const recoverReviewer = Effect.gen(function* () {
  const store = yield* EventStore;
  const sessions = yield* ReviewerSessions;
  const recovery = yield* store.review.recovery;

  for (const sessionId of recovery.sessions) yield* sessions.register(sessionId);
  const model = yield* store.model;

  for (const [sessionId, record] of model.sessions) {
    if (record.turns.some((turn) => turn.prompt.startsWith(REVIEWER_MARKER)))
      yield* sessions.register(sessionId);
  }

  const events = recovery.running.flatMap(abandonedEvents);

  if (events.length > 0)
    yield* store
      .commit({ commandId: null, decide: () => Effect.succeed(events) })
      .pipe(Effect.orDie);
});
