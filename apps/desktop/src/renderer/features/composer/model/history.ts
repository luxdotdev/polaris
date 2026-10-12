/**
 * ↑/↓ through what the user sent in a session (DESIGN.md, Working strip: sent messages come
 * back with ↑): Turn prompts and steers, oldest first, and a cursor over them that keeps
 * the unsent draft to restore past the newest.
 */
import type { TurnItem } from "@polaris/protocol";
import { Predicate } from "effect";

/** A Turn as history reads it: who started it, what it said, and the steers it took. */
export interface SentTurn {
  readonly id: string;
  readonly prompt: string;
  /** The Harness started it (background work reported), or it came from Review feedback. */
  readonly notTyped: boolean;
  readonly items: ReadonlyArray<TurnItem>;
}

/** Whether Polaris wrote a Turn's prompt (`itemId` null) or a steer (`polarisAuthored`). */
export type Authored = (turnId: string, itemId: string | null) => boolean;

const steersOf = (turn: SentTurn, authored: Authored) =>
  turn.items.flatMap((item) =>
    Predicate.isTagged(item, "UserMessage") && !authored(turn.id, item.id) ? [item.text] : []
  );

/**
 * What the user sent, oldest first, without what Polaris wrote (a digest, a brief, a steered
 * digest). Blank entries are dropped, and a message sent twice in a row is kept once.
 */
export const sentMessages = (
  turns: ReadonlyArray<SentTurn>,
  authored: Authored
): ReadonlyArray<string> =>
  turns
    .flatMap((turn) => [
      ...(turn.notTyped || authored(turn.id, null) ? [] : [turn.prompt]),
      ...steersOf(turn, authored),
    ])
    .filter((text, i, all) => text.trim() !== "" && text !== all[i - 1]);

/** Where ↑/↓ stands: null while editing the draft, else the entry shown. */
export interface HistoryCursor {
  readonly at: number | null;
  /** The draft as it was before the first ↑, put back past the newest entry. */
  readonly draft: string;
}

export const AT_DRAFT: HistoryCursor = { at: null, draft: "" };

/** ↑ is -1 (older), ↓ is 1 (newer); null when there's nowhere to go. */
export const stepHistory = (
  entries: ReadonlyArray<string>,
  cursor: HistoryCursor,
  by: 1 | -1,
  current: string
): { readonly cursor: HistoryCursor; readonly text: string } | null => {
  if (cursor.at === null) {
    const last = entries.length - 1;

    return by === 1 || last < 0
      ? null
      : { cursor: { at: last, draft: current }, text: entries[last] ?? "" };
  }

  const next = cursor.at + by;

  if (next < 0) return null;

  if (next >= entries.length) return { cursor: AT_DRAFT, text: cursor.draft };

  return { cursor: { ...cursor, at: next }, text: entries[next] ?? "" };
};
