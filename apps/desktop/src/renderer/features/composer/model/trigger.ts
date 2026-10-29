/**
 * The one detector behind the composer's menus: a `/` or `$` (Skills and
 * Slash Commands) or an `@` (file mentions) that starts a token at the caret.
 * Never inside a word, a path, a URL or an email, nor inside a code span.
 */

export type TriggerSigil = "/" | "$" | "@";

export interface Trigger {
  readonly sigil: TriggerSigil;
  /** What follows the sigil up to the caret. */
  readonly query: string;
  /** The typed word, sigil included (`/sim`, `@src/a`). */
  readonly word: string;
}

/** A sigil and the non-space run after it, ending at the caret. */
const TAIL = /([/$@])(\S*)$/;

/** Backticks open and close code spans and fences: an odd count before the caret is inside one. */
const inCode = (before: string) => (before.match(/`/g)?.length ?? 0) % 2 === 1;

/**
 * Whether a token may start after `before` (the draft so far): at its start or
 * after whitespace, outside code. `a/b`, `./src`, `x@y.com` and `http://` aren't.
 */
export const tokenStarts = (before: string) =>
  (before === "" || /\s$/.test(before)) && !inCode(before);

/**
 * The trigger under the caret: `before` is the draft up to the caret (chips
 * written as their text), `after` the character right after it, if any.
 */
export const findTrigger = (before: string, after: string | undefined): Trigger | null => {
  if (after !== undefined && !/\s/.test(after)) return null;
  const match = TAIL.exec(before);

  if (match === null || !tokenStarts(before.slice(0, match.index))) return null;
  // SAFETY: TAIL's first group only matches "/", "$" or "@".
  const sigil = match[1] as TriggerSigil;

  return { sigil, query: match[2] ?? "", word: match[0] };
};
