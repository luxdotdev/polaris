/**
 * One change of a hunk (its removed lines, then its added ones) aligned by `@polaris/syntax-diff`
 * over the light tokenizer: which lines pair, and the tokens to emphasise in each.
 */
import {
  alignLines,
  type Row,
  type Span,
  type TokenLine,
  tokenLines,
  TooComplex,
} from "@polaris/syntax-diff/core";
import { tokenize } from "./tokenize.ts";

export type { Row, Span } from "@polaris/syntax-diff/core";

/** Changed lines past which a change keeps plain pairs: the token diff would cost too much. */
export const MAX_CHANGE_EDITS = 500;

const NONE: ReadonlyArray<Span> = [];

const EMPTY: TokenLine = { text: "", tokens: [], fingerprint: "" };

/** Each line on its own, so the counts always match the hunk's (a trailing empty line included). */
const lineTokens = (text: string, path: string): TokenLine =>
  tokenLines(text, tokenize(text, path))[0] ?? EMPTY;

/** Lines paired in order with nothing emphasised, then the longer side's rest whole. */
const plainRows = (removed: number, added: number): ReadonlyArray<Row> =>
  Array.from({ length: Math.max(removed, added) }, (_, k) => ({
    kind: k < removed && k < added ? "modified" : k < removed ? "removed" : "added",
    old: k < removed ? k : null,
    new: k < added ? k : null,
    removed: NONE,
    added: NONE,
  }));

/** Rows over the change's own 0-based indexes: `old` into `removed`, `new` into `added`. */
export const alignChange = (
  removed: ReadonlyArray<string>,
  added: ReadonlyArray<string>,
  path: string
): ReadonlyArray<Row> => {
  if (removed.length === 0 || added.length === 0) return plainRows(removed.length, added.length);

  try {
    return alignLines(
      removed.map((text) => lineTokens(text, path)),
      added.map((text) => lineTokens(text, path)),
      MAX_CHANGE_EDITS
    );
  } catch (error) {
    if (error instanceof TooComplex) return plainRows(removed.length, added.length);
    throw error;
  }
};

export interface Segment {
  readonly text: string;
  readonly marked: boolean;
}

/** `text` cut at `spans` (sorted, apart), for one Text with nested emphasised runs. */
export const segments = (text: string, spans: ReadonlyArray<Span>): ReadonlyArray<Segment> => {
  const out: Array<Segment> = [];
  let at = 0;

  for (const span of spans) {
    const start = Math.max(at, Math.min(span.start, text.length));
    const end = Math.min(span.end, text.length);

    if (start > at) out.push({ text: text.slice(at, start), marked: false });

    if (end > start) out.push({ text: text.slice(start, end), marked: true });
    at = Math.max(at, end);
  }

  if (at < text.length) out.push({ text: text.slice(at), marked: false });

  return out;
};
