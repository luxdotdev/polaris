import type { Attempt, Claim, Constellation } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import { failureKindLabel } from "../failureKind.ts";

interface ReviewFeedback {
  feedback?: string;
  rejectedClaim?: Claim;
}

const line = (text: string) => text.replace(/\s+/g, " ").trim();

type LinkedCause = Exclude<Attempt["cause"], { readonly _tag: "Initial" }>;

const linkedFeedback = (graph: Constellation, cause: LinkedCause): ReviewFeedback => {
  const previous = graph.attempts.find((a) => a.id === cause.ref);

  if (previous === undefined) return {};
  const fields: ReviewFeedback = {};

  if (previous.claim != null) fields.rejectedClaim = previous.claim;

  const settled = previous.settleReason === null ? "" : `: ${line(previous.settleReason)}`;

  const feedback: string | undefined = Match.value(cause).pipe(
    Match.tag("SentBack", "MergeConflict", () => previous.rejectionReason ?? undefined),
    Match.tag(
      "Superseded",
      () =>
        `Attempt ${previous.id} was stopped by a Lead handover${previous.settleReason === null ? "" : ` (${line(previous.settleReason)})`}. Rerun its checks on the current graph; do not assume its result still holds.`
    ),
    Match.tag(
      "Recover",
      () =>
        `Attempt ${previous.id} could not be continued${settled}. Check the branch for uncommitted or unclaimed work before starting over.`
    ),
    Match.tag("Followup", (): string | undefined => {
      if (previous.state === "lost" || previous.state === "failed") {
        const kind =
          previous.failureKind === null ? "" : ` (${failureKindLabel(previous.failureKind)})`;

        const verdict =
          previous.failureKind === "capacity" || previous.failureKind === "transport"
            ? "the failure was not the implementation's"
            : "read the branch before deciding what to keep";

        return `Attempt ${previous.id} ${previous.state}${kind}${settled}. Its branch may hold partial work; ${verdict}.`;
      }

      if (previous.state === "rejected") return previous.rejectionReason ?? undefined;

      return `Attempt ${previous.id} was ${previous.state}; this Attempt follows it on the same Task.`;
    }),
    Match.exhaustive
  );

  if (feedback !== undefined) fields.feedback = feedback;

  return fields;
};

/** Every cause that names an earlier Attempt carries what that Attempt left behind. */
export const reviewFeedback = (graph: Constellation, attempt: Attempt): ReviewFeedback =>
  Match.value(attempt.cause).pipe(
    Match.tag("Initial", (): ReviewFeedback => ({})),
    Match.orElse((cause) => linkedFeedback(graph, cause))
  );

export const mergeFirst = (attempt: Attempt): string =>
  Predicate.isTagged(attempt.cause, "MergeConflict")
    ? `Merge conflict: merge ${attempt.cause.base} into your branch first, resolve the conflicts, then address the review feedback and claim again.`
    : "";
