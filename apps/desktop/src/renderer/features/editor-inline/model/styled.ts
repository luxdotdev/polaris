/** Highlighted text as lines of styled pieces: what the inline diff's added lines render. */

export interface StyledSpan {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

export interface Piece {
  readonly text: string;
  readonly className: string | null;
}

/** Splits `text` into lines of pieces; spans are ordered and don't overlap (as highlighters give them). */
export const styledLines = (
  text: string,
  spans: ReadonlyArray<StyledSpan>
): Array<Array<Piece>> => {
  const lines: Array<Array<Piece>> = [[]];

  const push = (piece: string, className: string | null) => {
    const parts = piece.split("\n");

    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);

      if (part !== "") lines.at(-1)?.push({ text: part, className });
    });
  };

  let at = 0;

  for (const span of spans) {
    if (span.from > at) push(text.slice(at, span.from), null);
    push(text.slice(Math.max(span.from, at), span.to), span.className);
    at = Math.max(at, span.to);
  }

  push(text.slice(at), null);

  return lines;
};
