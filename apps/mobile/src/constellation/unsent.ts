/**
 * A handed claim's unsent verdict: the chosen verdict and the typed answer, kept for one claim
 * (its Attempt, revision and head), so a replacement claim starts clean.
 */
import type { Verdict } from "./verdict.ts";

export type Step =
  | { readonly kind: "choose" }
  | { readonly kind: "reply"; readonly verdict: Verdict };

export interface Unsent {
  /** The claim this choice was made on (`claimKey`). */
  readonly claim: string;
  readonly step: Step;
  /** The typed answer; null until typed, so a refused delivery's answer shows instead. */
  readonly draft: string | null;
}

export interface ClaimRef {
  readonly attemptId: string;
  readonly revision: number;
  readonly head: string;
}

/** The same claim identity as the outbox's `deliveryKey`, without its Constellation and Task. */
export const claimKey = (claim: ClaimRef): string =>
  [claim.attemptId, claim.revision, claim.head].join("/");

export const fresh = (claim: string): Unsent => ({ claim, step: { kind: "choose" }, draft: null });

/** What was kept, if it was for this claim; else nothing chosen yet. */
export const unsentFor = (kept: Unsent | null, claim: string): Unsent =>
  kept !== null && kept.claim === claim ? kept : fresh(claim);

export const chosen = (claim: string, verdict: Verdict): Unsent => ({
  claim,
  step: { kind: "reply", verdict },
  draft: null,
});

export const typed = (unsent: Unsent, draft: string): Unsent => ({ ...unsent, draft });
