/**
 * Handlers for the Review reads the store answers on its own: a Risk
 * Summary by id or key, a summary as it fills in, and Verdicts. Running
 * summaries, asking the Reviewer and a checkout's live status belong to
 * the Rules, Reviewer and Checkout modules (the transport's defaults answer
 * `Unsupported` until they land).
 */
import {
  GetRiskSummary,
  ListVerdicts,
  NotFound,
  type RiskSummary,
  type RiskSummaryId,
  RiskSummaryRef,
  WatchRiskSummary,
} from "@polaris/protocol";
import { Effect, Predicate, Result, Stream } from "effect";
import { RpcGroup } from "effect/rpc";
import { EventStore } from "../store/EventStore.ts";
import type { LiveItem } from "../store/hub.ts";
import { summaryIdOf } from "../store/review.ts";

export class ReviewReadRpcs extends RpcGroup.make(GetRiskSummary, WatchRiskSummary, ListVerdicts) {}

const isAbout =
  (summaryId: RiskSummaryId) =>
  (item: LiveItem): boolean =>
    Predicate.isTagged(item, "Event") && summaryIdOf(item.envelope.event) === summaryId;

/**
 * The summary now, then again after each event about it. Subscribes before
 * reading, so nothing committed in between is missed; a repeat is harmless.
 */
export const watchRiskSummary = (
  store: EventStore["Service"],
  summaryId: RiskSummaryId
): Stream.Stream<RiskSummary, NotFound> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const live = yield* store.subscribe({ filter: isAbout(summaryId) });
      const read = store.review.riskSummary(RiskSummaryRef.cases.ById.make({ summaryId }));
      const first = yield* read;

      if (first === null) return yield* new NotFound({ what: "risk summary", id: summaryId });

      const updates = live.pipe(
        Stream.mapEffect(() => read),
        Stream.filterMap((summary) =>
          summary === null ? Result.failVoid : Result.succeed(summary)
        )
      );

      return Stream.concat(Stream.succeed(first), updates);
    })
  );

export const ReviewReadRpcsLive = ReviewReadRpcs.toLayer(
  Effect.gen(function* () {
    const store = yield* EventStore;

    return {
      "review.riskSummary": ({ ref }) => store.review.riskSummary(ref),
      "review.watchRiskSummary": ({ summaryId }) => watchRiskSummary(store, summaryId),
      "review.verdicts": (query) => store.review.verdicts(query),
    };
  })
);
