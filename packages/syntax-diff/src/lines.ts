/**
 * A file's tokens laid out per line. A token spanning lines (a template literal, a block
 * comment, JSX text) is cut at each line break and into words, so an edit inside it
 * lights only the words that changed, on the line where they changed.
 */
import type { SyntaxToken, TokenKind } from "./tokens.ts";

export interface LineToken {
  /** UTF-16 column in the line's text. */
  readonly col: number;
  readonly text: string;
  readonly kind: TokenKind;
}

export interface TokenLine {
  readonly text: string;
  readonly tokens: ReadonlyArray<LineToken>;
  /** The line's tokens without whitespace: lines that differ only in spacing match. */
  readonly fingerprint: string;
}

/** The file's lines, without the empty one after a final line break. */
export const splitLines = (source: string): Array<string> => {
  if (source === "") return [];
  const lines = source.split(/\r\n|\r|\n/);

  if (/[\r\n]$/.test(source)) lines.pop();

  return lines;
};

const lineStarts = (source: string): Array<number> => {
  const starts = [0];

  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);

    if (c === 13 && source.charCodeAt(i + 1) === 10) continue;

    if (c === 10 || c === 13) starts.push(i + 1);
  }

  return starts;
};

const lineOf = (starts: ReadonlyArray<number>, pos: number) => {
  let lo = 0;
  let hi = starts.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;

    if ((starts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }

  return lo;
};

const isInlineSpace = (c: number) => c === 32 || c === 9;

/** `;` `,` `)` `]` `}` `>` and a closing backtick: peeled off a word so `'self';` stays put. */
const isTrailingPunctuation = (c: number) =>
  c === 59 || c === 44 || c === 41 || c === 93 || c === 125 || c === 62 || c === 96;

const isBreak = (c: number) => c === 10 || c === 13;

/** Kinds that hold words: split even on one line, so an edit in a sentence marks its words. */
const PROSE = new Set<TokenKind>(["comment", "string", "text"]);

interface Sink {
  readonly push: (kind: TokenKind, text: string, pos: number) => void;
}

/** One line's slice of a multi-line token, split at spaces, trailing punctuation on its own. */
const pushWords = (sink: Sink, kind: TokenKind, text: string, base: number) => {
  let i = 0;

  while (i < text.length) {
    while (i < text.length && isInlineSpace(text.charCodeAt(i))) i++;
    const start = i;

    while (i < text.length && !isInlineSpace(text.charCodeAt(i))) i++;
    let core = i;

    while (core > start && isTrailingPunctuation(text.charCodeAt(core - 1))) core--;

    if (core > start) sink.push(kind, text.slice(start, core), base + start);

    for (let k = core; k < i; k++) sink.push(kind, text.slice(k, k + 1), base + k);
  }
};

const pushToken = (sink: Sink, kind: TokenKind, text: string, pos: number) => {
  let from = 0;
  let broken = false;

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);

    if (!isBreak(c)) continue;
    broken = true;
    pushWords(sink, kind, text.slice(from, i), pos + from);

    if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
    from = i + 1;
  }

  if (broken || PROSE.has(kind)) pushWords(sink, kind, text.slice(from), pos + from);
  else sink.push(kind, text, pos);
};

/** Lays `tokens` (in source order) out on the lines of `source`. */
export const tokenLines = (
  source: string,
  tokens: ReadonlyArray<SyntaxToken>
): Array<TokenLine> => {
  const texts = splitLines(source);
  const starts = lineStarts(source);
  const perLine: Array<Array<LineToken>> = texts.map(() => []);

  const sink: Sink = {
    push: (kind, text, pos) => {
      if (text.length === 0) return;
      const line = lineOf(starts, pos);

      perLine[line]?.push({ col: pos - (starts[line] ?? 0), text, kind });
    },
  };

  for (const token of tokens) {
    pushToken(sink, token.kind, source.slice(token.start, token.end), token.start);
  }

  return texts.map((text, i) => {
    const lineTokens = perLine[i] ?? [];

    return {
      text,
      tokens: lineTokens,
      fingerprint: lineTokens.map((t) => `${t.kind}:${t.text}`).join("\u0001"),
    };
  });
};
