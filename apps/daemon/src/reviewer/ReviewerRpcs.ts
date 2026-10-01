/**
 * Handlers for running Risk Summaries, follow-ups to the Reviewer, and the
 * Reviewer settings (capabilities `review.risk-summary`, `review.ask`,
 * `review.reviewer-settings`).
 */
import {
  AskFinding,
  GetReviewerSettings,
  RunRiskSummary,
  RunWalkthrough,
  StopWalkthrough,
  SetReviewerSettings,
} from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { Reviewer } from "./index.ts";

export class ReviewerRpcs extends RpcGroup.make(
  RunRiskSummary,
  RunWalkthrough,
  StopWalkthrough,
  AskFinding,
  GetReviewerSettings,
  SetReviewerSettings
) {}

export const ReviewerRpcsLive = ReviewerRpcs.toLayer(
  Effect.gen(function* () {
    const reviewer = yield* Reviewer;

    return {
      "review.runWalkthrough": ({ summaryId, context }) =>
        reviewer.runWalkthrough(summaryId, context),
      "review.stopWalkthrough": ({ summaryId }) => reviewer.stopWalkthrough(summaryId),
      "review.runRiskSummary": (request) => reviewer.run(request),
      "review.askFinding": ({ summaryId, findingId, question }) =>
        reviewer.ask(summaryId, findingId, question),
      "review.reviewerSettings": ({ workspaceId }) => reviewer.settings(workspaceId),
      "review.setReviewerSettings": ({ settings }) =>
        reviewer.setSettings(settings).pipe(Effect.orDie),
    };
  })
);
