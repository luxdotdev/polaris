/**
 * What Review's worker action does (spec §7): Approve tells the Lead the user's verdict (the
 * Lead merges and accepts); Send to @worker sends the feedback back as a send-back; Accept
 * and merge myself accepts the claimed head the user read, which the Lead's Host merges.
 */
import {
  type Attempt,
  type ConstellationId,
  MessageTarget,
  ReviewAction,
  WorkerPlacement,
} from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import type { Plain } from "../../../store/plain.ts";
import { batchOf, setBatch } from "../../comments/data/store.ts";
import { emptyBatch } from "../../comments/model/feedback.ts";
import {
  claimRefusal,
  type ClaimPlace,
  type RefusalCopy,
} from "../../constellation/model/index.ts";
import { constellationRequest, sendConstellation } from "../../sessions/constellationApi.ts";
import { sendBackReason } from "./model.ts";

export interface WorkerTarget {
  /** The Lead's Host, where the Constellation's commands go. */
  readonly leadHostKey: string;
  readonly constellationId: ConstellationId;
  readonly attempt: Plain<Attempt>;
}

const placeOf = (attempt: Plain<Attempt>, leadBranch: string | null): ClaimPlace => ({
  taskId: attempt.taskId,
  branch: attempt.branch,
  head: attempt.claim?.head ?? "",
  leadBranch,
});

/** A refused review in the user's words; Approve rides along when it would work instead. */
const toastRefusal = (title: string, copy: RefusalCopy, approve: (() => void) | null) => {
  const toast = {
    source: "starlight" as const,
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message: copy.message,
  };

  if (copy.offerApprove && approve !== null)
    showToast({ ...toast, action: { label: "Approve", onAction: approve } });
  else showToast(toast);
};

/** Records the user's verdict (`approvedByUserAt`); the Attempt is accepted once the Lead merges it. */
export const approveClaim = async (target: WorkerTarget) => {
  const { leadHostKey, constellationId, attempt } = target;

  const result = await constellationRequest(leadHostKey, "constellation.review", {
    constellationId,
    attemptId: attempt.id,
    revision: attempt.revision,
    action: ReviewAction.cases.Approve.make({}),
  });

  if (!result.ok)
    toastRefusal(
      `Couldn't approve ${attempt.taskId}`,
      claimRefusal(result.error, placeOf(attempt, null)),
      null
    );

  return result.ok;
};

/** The Review feedback as a send-back to the same session; the batch clears once it lands. */
export const sendToWorker = async (target: WorkerTarget, subjectKey: string) => {
  const reason = sendBackReason(batchOf(subjectKey)) ?? "Sent back from Review.";

  const sent = await sendConstellation(
    target.leadHostKey,
    "constellation.review",
    {
      constellationId: target.constellationId,
      attemptId: target.attempt.id,
      revision: target.attempt.revision,
      action: ReviewAction.cases.SendBack.make({
        reason,
        worker: WorkerPlacement.cases.Existing.make({ sessionId: target.attempt.sessionId }),
      }),
    },
    "Couldn't send it back"
  );

  if (sent) setBatch(subjectKey, emptyBatch);

  return sent;
};

/** The Review feedback as a steer while the worker still works; journaled, so the Lead is told. */
export const steerWorker = async (target: WorkerTarget, subjectKey: string) => {
  const text = sendBackReason(batchOf(subjectKey));

  if (text === null) return false;

  const sent = await sendConstellation(
    target.leadHostKey,
    "constellation.message",
    {
      constellationId: target.constellationId,
      target: MessageTarget.cases.Worker.make({ attemptId: target.attempt.id }),
      text,
    },
    "Couldn't send it"
  );

  if (sent) setBatch(subjectKey, emptyBatch);

  return sent;
};

/** The Claim as the user read it in Review: Accept takes exactly this head. */
export interface SeenClaim {
  readonly head: string;
  readonly revision: number;
}

export interface AcceptPlace {
  /** The Lead's branch, when its checkout is known; the refusal names it. */
  readonly leadBranch: string | null;
  /** Runs when the user takes Approve from a refusal instead. */
  readonly onApprove: () => void;
}

/** Accepts the head the user read; the Lead's Host merges it into the Lead's branch first. */
export const acceptClaim = async (target: WorkerTarget, seen: SeenClaim, place: AcceptPlace) => {
  const { attempt } = target;
  const claim = attempt.claim;

  if (claim == null) return false;

  const accepted = await constellationRequest(target.leadHostKey, "constellation.review", {
    constellationId: target.constellationId,
    attemptId: attempt.id,
    revision: seen.revision,
    action: ReviewAction.cases.Accept.make({ mergedHead: seen.head, receipts: claim.receipts }),
  });

  if (!accepted.ok)
    toastRefusal(
      `Couldn't accept ${attempt.taskId}`,
      claimRefusal(accepted.error, { ...placeOf(attempt, place.leadBranch), head: seen.head }),
      place.onApprove
    );

  return accepted.ok;
};
