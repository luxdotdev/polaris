/** A Lead's digest Turn folded to one line: its number and what the Lead said back. */
import { Predicate } from "effect";
import type { TurnView } from "../../../store/sessionModel.ts";
import type { Digest } from "./types.ts";

export interface DigestFold {
  /** One-based, as the conversation numbers Turns. */
  readonly number: number;
  /** The first line of the Lead's last message in the Turn; null before it replies. */
  readonly reply: string | null;
}

export const digestFold = (view: TurnView): DigestFold => {
  const last = view.items.findLast((item) => Predicate.isTagged(item, "AssistantMessage"));
  const line = last?.text.trimStart().split("\n", 1)[0]?.trim() ?? "";

  return { number: view.turn.index + 1, reply: line === "" ? null : line };
};

/**
 * Polaris started this Lead Turn for a digest (the turn-origin contract). A steered digest
 * landed in a Turn someone else started, so that Turn stays theirs.
 */
export const digestStarted = (digests: ReadonlyArray<Digest>, turnId: string) =>
  digests.some((d) => d.turnId === turnId && d.steered !== true);
