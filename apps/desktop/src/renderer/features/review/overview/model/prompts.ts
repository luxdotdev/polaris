/**
 * An Agent Session's prompts under review (`ReviewPrompt`, one per Daemon Turn), one row per
 * Turn as the UI numbers it (`turnGroups.ts`): a Turn the Harness started isn't a prompt.
 */
import type { TurnPromptView } from "./types.ts";

/** A Daemon Turn's place in the UI's numbering, by its index. */
export interface PromptTurn {
  readonly number: number;
  /** The Harness started it: its files count toward the Turn it continues. */
  readonly continued: boolean;
}

export interface PromptRow {
  readonly number: number;
  readonly prompt: string;
  readonly files: number;
}

/** Each Daemon Turn's place, from the session's Turns as Review groups them (`ReviewTurn`). */
export const promptTurns = (
  turns: ReadonlyArray<{
    readonly number: number;
    readonly prompt: string | null;
    readonly turns: ReadonlyArray<{ readonly index: number }>;
  }>
): ReadonlyMap<number, PromptTurn> =>
  new Map(
    turns.flatMap((turn) =>
      turn.turns.map((t, i): [number, PromptTurn] => [
        t.index,
        { number: turn.number, continued: i > 0 || turn.prompt === null },
      ])
    )
  );

/** Newest first; a Turn not listed in `turns` keeps its own number. */
export const promptRows = (
  prompts: ReadonlyArray<TurnPromptView>,
  turns: ReadonlyMap<number, PromptTurn>
): ReadonlyArray<PromptRow> => {
  const rows = new Map<number, { prompt: string | null; files: number }>();

  for (const p of prompts.toSorted((a, b) => a.turnIndex - b.turnIndex)) {
    const at = turns.get(p.turnIndex);
    const number = at?.number ?? p.turnIndex + 1;
    const prompt = at?.continued === true ? null : p.prompt;
    const row = rows.get(number);

    rows.set(number, {
      prompt: row?.prompt ?? prompt,
      files: (row?.files ?? 0) + p.files,
    });
  }

  return [...rows]
    .flatMap(([number, { prompt, files }]) => (prompt === null ? [] : [{ number, prompt, files }]))
    .toReversed();
};
