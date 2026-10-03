/**
 * A refused Claim review in the user's words (product-design references/copy.md): each Daemon
 * finding code becomes one line with the next step, and never the agent-facing fix.
 */
import type { IpcFinding } from "../../../../shared/api.ts";
import { shortSha } from "./copy.ts";

export interface ClaimPlace {
  readonly taskId: string;
  /** The worker's branch, which the Lead merges. */
  readonly branch: string;
  readonly head: string;
  /** The Lead's branch, when its checkout is known. */
  readonly leadBranch: string | null;
}

export interface RefusalCopy {
  readonly message: string;
  /** Approving instead would succeed: the Lead merges and accepts. */
  readonly offerApprove: boolean;
}

export interface Refusal {
  readonly message: string;
  readonly findings?: ReadonlyArray<IpcFinding> | undefined;
}

type Word = (place: ClaimPlace) => RefusalCopy;

/** The way to merge, named the same everywhere a merge is missing. */
export const mergeFirst = (place: ClaimPlace) =>
  `Merge ${place.branch} at ${shortSha(place.head)} into ${place.leadBranch ?? "the lead's branch"} first, or approve and let the lead merge.`;

const notInReview: Word = (p) => ({
  message: `${p.taskId}'s claim is no longer in review.`,
  offerApprove: false,
});

const WORDS = new Map<string, Word>([
  ["E-GIT", (p) => ({ message: mergeFirst(p), offerApprove: true })],
  [
    "E-MERGED-HEAD",
    (p) => ({
      message: `Accept ${shortSha(p.head)}, the claimed head, or approve and let the lead merge.`,
      offerApprove: true,
    }),
  ],
  [
    "E-RECEIPT-FAILED",
    (p) => ({
      message: `A receipt's check failed. Leave it out, or send ${p.taskId} back.`,
      offerApprove: false,
    }),
  ],
  [
    "E-RECEIPT-UNKNOWN",
    (p) => ({
      message: `A receipt doesn't match a recorded command. Leave it out, or send ${p.taskId} back.`,
      offerApprove: false,
    }),
  ],
  [
    "E-REVISION",
    (p) => ({
      message: `${p.taskId}'s claim changed since you opened it. Read it again, then decide.`,
      offerApprove: false,
    }),
  ],
  ["E-SETTLED", notInReview],
  ["E-ATTEMPT-UNKNOWN", notInReview],
  ["E-REVIEW", notInReview],
]);

/** The first finding with words of its own wins; others show their message without the fix. */
export const claimRefusal = (error: Refusal, place: ClaimPlace): RefusalCopy => {
  const findings = error.findings ?? [];

  for (const finding of findings) {
    const word = WORDS.get(finding.code);

    if (word !== undefined) return word(place);
  }

  const first = findings[0];

  if (first === undefined) return { message: error.message, offerApprove: false };

  return { message: `${first.message.replace(/\.$/, "")}.`, offerApprove: false };
};
