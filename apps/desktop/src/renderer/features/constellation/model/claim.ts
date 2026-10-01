/** A Claim and its receipts as the tab shows them: at a glance on a row, in full in a card. */
import type { CheckReceipt } from "@polaris/protocol";
import { Match } from "effect";
import type { Plain } from "../../../store/plain.ts";
import type { Facts } from "./facts.ts";
import type { AttemptData, ClaimData } from "./types.ts";

export interface ReceiptView {
  readonly label: string;
  /** Verified points at a Daemon-recorded tool call; reported is text only. */
  readonly tier: "verified" | "reported";
  /** Passed, failed, or not known (no exit code yet). */
  readonly ok: boolean | null;
  readonly command: string | null;
  readonly exitCode: number | null;
}

const passed = (exitCode: number | null) => (exitCode === null ? null : exitCode === 0);

export const receiptView = (receipt: Plain<CheckReceipt>, facts: Facts): ReceiptView =>
  Match.value(receipt).pipe(
    Match.tagsExhaustive({
      Verified: ({ label, item }): ReceiptView => {
        const result = facts.receipt(item);
        const exitCode = result?.exitCode ?? null;

        return {
          label,
          tier: "verified",
          ok: passed(exitCode),
          command: result?.command ?? null,
          exitCode,
        };
      },
      Reported: ({ label, command, exitCode }): ReceiptView => ({
        label,
        tier: "reported",
        ok: passed(exitCode ?? null),
        command: command ?? null,
        exitCode: exitCode ?? null,
      }),
    })
  );

export interface ClaimGlance {
  readonly head: string;
  readonly commits: number;
  readonly checks: ReadonlyArray<ReceiptView>;
  readonly notDone: number;
  /** Questions to anyone; the row counts them in needs-you-text. */
  readonly questions: number;
  /** True when no receipt came with the Claim (asserted). */
  readonly asserted: boolean;
}

export const claimGlance = (claim: ClaimData, facts: Facts): ClaimGlance => ({
  head: claim.head,
  commits: claim.commits.length,
  checks: claim.receipts.map((r) => receiptView(r, facts)),
  notDone: claim.notDone.length,
  questions: claim.questions.length,
  asserted: claim.receipts.length === 0,
});

/** An accepted Attempt's merged head and receipts (a Gate's second line). */
export const acceptedGlance = (attempt: AttemptData, facts: Facts) =>
  attempt.mergedHead == null
    ? null
    : {
        head: attempt.mergedHead,
        receipts: (attempt.receipts ?? []).map((r) => receiptView(r, facts)),
      };

/** The decider's rule: the merged head must be the claimed head (a prefix of either counts). */
export const headMatches = (claimed: string, merged: string) => {
  const a = claimed.trim().toLowerCase();
  const b = merged.trim().toLowerCase();

  return b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
};
