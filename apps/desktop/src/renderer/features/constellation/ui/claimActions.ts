/**
 * Claim review from the tab: Approve (the Lead merges and accepts), and refusals worded by
 * `claimRefusal` rather than the Daemon's agent-facing fix (DESIGN.md, Reviewing a Claim).
 */
import { ReviewAction } from "@polaris/protocol";
import { PixelCheckIcon, PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import { type ReviewInput, sendReview } from "../client.ts";
import {
  type AttemptData,
  type ClaimPlace,
  claimRefusal,
  type ConstellationRecord,
  type RefusalCopy,
} from "../model/index.ts";

export const placeOf = (attempt: AttemptData, leadBranch: string | null): ClaimPlace => ({
  taskId: attempt.taskId,
  branch: attempt.branch,
  head: attempt.claim?.head ?? "",
  leadBranch,
});

/** Sends a review; null when the Daemon took it, else the refusal in the user's words. */
export const reviewClaim = async (
  hostKey: string,
  input: ReviewInput,
  place: ClaimPlace
): Promise<RefusalCopy | null> => {
  const outcome = await sendReview(hostKey, input);

  return outcome.ok ? null : claimRefusal(outcome, place);
};

export const toastRefusal = (title: string, copy: RefusalCopy) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message: copy.message,
  });

/** Records the user's verdict; a digest tells the Lead to merge and accept. */
export const approveClaim = async (
  hostKey: string,
  record: ConstellationRecord,
  attempt: AttemptData,
  place: ClaimPlace
) => {
  const refused = await reviewClaim(
    hostKey,
    {
      constellationId: record.constellation.id,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.Approve.make({}),
    },
    place
  );

  if (refused === null)
    showToast({
      source: "starlight",
      icon: createElement(PixelCheckIcon, { size: 16 }),
      title: `Approved ${attempt.taskId}`,
      message: "The lead merges and accepts it",
    });
  else toastRefusal(`Couldn't approve ${attempt.taskId}`, refused);

  return refused === null;
};
