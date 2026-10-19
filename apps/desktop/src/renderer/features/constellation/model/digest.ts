/** A Lead's digest Turn folded to one line: its number and what the Lead said back. */
import { Predicate } from "effect";
import type { TurnView } from "../../../store/sessionModel.ts";
import { turnNumber } from "../../session/model/turnGroups.ts";
import type { Digest } from "./types.ts";

export interface DigestFold {
  /** One-based, as the conversation numbers Turns. */
  readonly number: number;
  /** The first line of the Lead's last message in the Turn; null before it replies. */
  readonly reply: string | null;
}

/** `view` folded, numbered among the Lead's listed `views` as the conversation numbers it. */
export const digestFold = (views: ReadonlyArray<TurnView>, view: TurnView): DigestFold => {
  const last = view.items.findLast((item) => Predicate.isTagged(item, "AssistantMessage"));
  const line = last?.text.trimStart().split("\n", 1)[0]?.trim() ?? "";
  const number = turnNumber(views, view.turn.id) ?? view.turn.userTurnNumber ?? view.turn.index + 1;

  return { number, reply: line === "" ? null : line };
};

/**
 * Polaris started this Lead Turn for a digest (the turn-origin contract). A steered digest
 * landed in a Turn someone else started, so that Turn stays theirs.
 */
export const digestStarted = (digests: ReadonlyArray<Digest>, turnId: string) =>
  digests.some((d) => d.turnId === turnId && d.steered !== true);

/** How the Daemon opens a digest it steers into a Working Lead (`steeredDigestPrompt`). */
export const STEERED_DIGEST_OPENING = "This update arrived during your Turn.";

/**
 * The steered digest a landed steer carried, or null when the user wrote it. Several in one
 * Turn pair up in order: the n-th digest steer with the n-th steered digest.
 */
export const steeredDigest = (
  digests: ReadonlyArray<Digest>,
  view: TurnView,
  itemId: string
): Digest | null => {
  const steers = view.items.filter(
    (item) =>
      Predicate.isTagged(item, "UserMessage") && item.text.startsWith(STEERED_DIGEST_OPENING)
  );

  const n = steers.findIndex((item) => item.id === itemId);

  if (n === -1) return null;

  const landed = digests
    .filter((d) => d.steered === true && d.turnId === view.turn.id)
    .toSorted((a, b) => a.at.localeCompare(b.at));

  return landed[n] ?? landed.at(-1) ?? null;
};
