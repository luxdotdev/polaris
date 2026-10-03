import type { Attempt, Claim, Constellation } from "@polaris/protocol";
import { Predicate } from "effect";

interface ReviewFeedback {
  feedback?: string;
  rejectedClaim?: Claim;
}

/** Follow the retry's cause, rather than another Attempt that happens to share its Session. */
export const reviewFeedback = (graph: Constellation, attempt: Attempt) => {
  const cause = attempt.cause;

  if (!Predicate.isTagged(cause, "SentBack") && !Predicate.isTagged(cause, "MergeConflict"))
    return {};

  const rejected = graph.attempts.find((a) => a.id === cause.ref);

  const fields: ReviewFeedback = {};

  if (rejected?.rejectionReason != null) fields.feedback = rejected.rejectionReason;

  if (rejected?.claim != null) fields.rejectedClaim = rejected.claim;

  return fields;
};

export const mergeFirst = (attempt: Attempt): string =>
  Predicate.isTagged(attempt.cause, "MergeConflict")
    ? `Merge conflict: merge ${attempt.cause.base} into your branch first, resolve the conflicts, then address the review feedback and claim again.`
    : "";
