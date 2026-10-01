/**
 * What Review's worker action does (spec §7): Approve tells the Lead the user's verdict (the
 * Lead merges and accepts); Send to @worker sends the feedback back as a send-back; Accept
 * and merge myself merges the claimed head in the Lead's checkout, then accepts with it.
 */
import {
  type Attempt,
  type ConstellationId,
  MessageTarget,
  ReviewAction,
  type SessionId,
  WorkerPlacement,
} from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import { batchOf, setBatch } from "../../comments/data/store.ts";
import { emptyBatch } from "../../comments/model/feedback.ts";
import { polaris } from "../../bridge.ts";
import { showRefusal } from "../../session/dispatch.ts";
import { sendConstellation } from "../../sessions/constellationApi.ts";
import { runInTerminal } from "../../terminal/actions.ts";
import { followExit } from "../checkout/exit.ts";
import { sendBackReason } from "./model.ts";

export interface WorkerTarget {
  /** The Lead's Host, where the Constellation's commands go. */
  readonly leadHostKey: string;
  readonly constellationId: ConstellationId;
  readonly attempt: Plain<Attempt>;
}

export const approveClaim = ({ leadHostKey, constellationId, attempt }: WorkerTarget) =>
  sendConstellation(
    leadHostKey,
    "constellation.message",
    {
      constellationId,
      target: MessageTarget.cases.Lead.make({}),
      authority: "may_decide_and_continue",
      text: `I approved ${attempt.taskId}'s claim at ${attempt.claim?.head.slice(0, 7) ?? "its head"}. Merge it, run the checks and accept it.`,
    },
    "Couldn't approve"
  );

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

export interface MergePlace {
  readonly workspaceId: string;
  /** The Lead's checkout: where its branch is. */
  readonly cwd: string;
  readonly leadSessionId: SessionId;
}

const exitOf = (hostKey: string, terminalId: string) =>
  new Promise<number | null>((resolve) => {
    followExit(hostKey, terminalId, resolve);
  });

/** Merges the claimed head in the Lead's checkout (in a terminal tab), then accepts with it. */
export const acceptAndMerge = async (target: WorkerTarget, place: MergePlace) => {
  const { attempt } = target;
  const claim = attempt.claim;

  if (claim == null) return false;

  const terminalId = await runInTerminal(
    { hostKey: target.leadHostKey, workspaceId: place.workspaceId },
    {
      key: `constellation-merge:${attempt.id}`,
      title: `Merge ${attempt.taskId}`,
      cwd: place.cwd,
      argv: ["git", "merge", "--no-edit", claim.head],
      sessionId: place.leadSessionId,
    }
  );

  if (terminalId === null) return false;
  const code = await exitOf(target.leadHostKey, terminalId);

  if (code !== 0) {
    showRefusal(`Couldn't merge ${attempt.taskId}`, {
      code: "MergeFailed",
      message: "git merge stopped; its terminal tab says why. Nothing was accepted.",
    });

    return false;
  }

  const status = await polaris().request("git.status", {
    hostKey: target.leadHostKey,
    cwd: place.cwd,
  });

  const head = status.ok ? status.value.head : null;

  if (head === null) {
    showRefusal(`Couldn't accept ${attempt.taskId}`, {
      code: "NoHead",
      message: "Merged, but the lead's checkout has no head to accept with.",
    });

    return false;
  }

  return sendConstellation(
    target.leadHostKey,
    "constellation.review",
    {
      constellationId: target.constellationId,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.Accept.make({ mergedHead: head, receipts: claim.receipts }),
    },
    `Couldn't accept ${attempt.taskId}`
  );
};
