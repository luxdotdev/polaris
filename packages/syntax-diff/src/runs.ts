/**
 * Tokens from a highlighter's runs: each line's coloured spans, classed by the scope group
 * they were coloured for. Highlighters merge neighbours of one colour ("):", "foo.bar") and
 * fold spaces into the next span, so runs are cut back into words and marks here.
 */
import type { SyntaxToken, TokenKind } from "./tokens.ts";

export interface TokenRun {
  readonly text: string;
  readonly kind: TokenKind;
}

/** A word of letters, digits, `_` or `$`, or any other single mark; spaces are skipped. */
const PIECES = /[\p{L}\p{N}_$]+|\S/gu;

/** Words and marks of a run, with their offsets in the line. */
const pieces = (text: string, base: number, kind: TokenKind): Array<SyntaxToken> =>
  [...text.matchAll(PIECES)].map((m) => ({
    start: base + m.index,
    end: base + m.index + m[0].length,
    kind,
  }));

/** Strings and comments stay whole (lines.ts splits them into words); code is cut into pieces. */
const tokensOfRun = (run: TokenRun, base: number): Array<SyntaxToken> => {
  if (run.kind !== "string" && run.kind !== "comment") return pieces(run.text, base, run.kind);

  const lead = run.text.length - run.text.trimStart().length;
  const end = base + run.text.trimEnd().length;

  return end > base + lead ? [{ start: base + lead, end, kind: run.kind }] : [];
};

const lineStarts = (source: string) => {
  const starts = [0];

  for (const match of source.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);

  return starts;
};

/** One line's tokens appended to `tokens`; false when its runs don't spell the line. */
const addLine = (
  source: string,
  start: number,
  runs: ReadonlyArray<TokenRun>,
  tokens: Array<SyntaxToken>
) => {
  let at = start;

  // An empty line is drawn as one "\n" run; it spells nothing in the line.
  for (const run of runs) {
    if (/^[\r\n]*$/.test(run.text)) continue;

    if (!source.startsWith(run.text, at)) return false;
    tokens.push(...tokensOfRun(run, at));
    at += run.text.length;
  }

  return true;
};

/**
 * `tokensFromRuns` a slice at a time: it pauses (yields) after every `slice` lines, so a
 * caller on a UI thread can let a frame through, and returns the tokens or null.
 */
export function* tokensFromRunsInSlices(
  source: string,
  lines: ReadonlyArray<ReadonlyArray<TokenRun>>,
  slice = 500
): Generator<void, Array<SyntaxToken> | null> {
  const starts = lineStarts(source);
  const tokens: Array<SyntaxToken> = [];

  for (const [i, runs] of lines.entries()) {
    const start = starts[i];

    if (start === undefined) return runs.length === 0 ? tokens : null;

    if (!addLine(source, start, runs, tokens)) return null;

    if ((i + 1) % slice === 0) yield;
  }

  return tokens;
}

/**
 * Tokens of `source` from its lines' runs, in order; null when the runs don't spell the
 * source (a highlighter that rewrote it), so the caller falls back to a line diff.
 */
export const tokensFromRuns = (
  source: string,
  lines: ReadonlyArray<ReadonlyArray<TokenRun>>
): Array<SyntaxToken> | null => {
  const slices = tokensFromRunsInSlices(source, lines, Number.POSITIVE_INFINITY);

  for (;;) {
    const step = slices.next();

    if (step.done === true) return step.value;
  }
};

/** A tokenizer that answers with tokens found earlier, by source text: highlighter output. */
export const fixedTokenizer = (
  id: string,
  known: ReadonlyArray<readonly [string, ReadonlyArray<SyntaxToken>]>
) => {
  const bySource = new Map(known);

  return { id, tokenize: (source: string) => bySource.get(source) ?? [] };
};
