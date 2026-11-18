/**
 * Who reviewed a Claim (ENG-941): the owner reads as "you", a Teammate who approved or sent it
 * back through a Share by name (`Attempt.reviewedBy`).
 */
import { Predicate } from "effect";
import type { AttemptData } from "./types.ts";

/** The Teammate who reviewed the Attempt's Claim; null when the owner did, or no one yet. */
export const teammateReviewer = (attempt: AttemptData | null | undefined): string | null => {
  const actor = attempt?.reviewedBy;

  return actor != null && Predicate.isTagged(actor, "Teammate") ? actor.name : null;
};

/** The digest's line for an approved Claim. */
export const approvedLine = (attempt: AttemptData | null): string =>
  `approved by ${teammateReviewer(attempt) ?? "you"} · the lead merges`;

/** The Claim head's note on who reviewed it, shown only for a Teammate. */
export const reviewerNote = (attempt: AttemptData): string | null => {
  const name = teammateReviewer(attempt);

  if (name === null) return null;

  if (attempt.state === "rejected") return ` · by ${name}`;

  return attempt.approvedByUserAt == null ? null : ` · approved by ${name}`;
};
