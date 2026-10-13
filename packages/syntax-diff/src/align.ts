/**
 * Lines matched by their tokens, then each changed pair diffed token by token: a pair whose
 * only change is new tokens is an insertion within the line (no red at all), and a rename
 * marks just the old and new names.
 */
import type { LineToken, TokenLine } from "./lines.ts";
import { myers } from "./myers.ts";

/**
 * - `equal`: the same tokens (spacing may differ).
 * - `inserted`: the new line is the old one plus tokens; only `added` is set.
 * - `modified`: a changed pair; `removed` and `added` hold the changed tokens.
 */
export type RowKind = "equal" | "added" | "removed" | "modified" | "inserted";

/** `[start, end)` in a line's text. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Row {
  readonly kind: RowKind;
  /** 0-based line indexes; null on the side the row doesn't have. */
  readonly old: number | null;
  readonly new: number | null;
  readonly removed: ReadonlyArray<Span>;
  readonly added: ReadonlyArray<Span>;
}

/** Lines longer than this keep a plain changed pair: no token diff, as Pierre's own word diff. */
export const MAX_TOKEN_DIFF_LINE = 1000;

const NONE: ReadonlyArray<Span> = [];

const lineRow = (kind: "equal" | "added" | "removed", old: number | null, nu: number | null) => ({
  kind,
  old,
  new: nu,
  removed: NONE,
  added: NONE,
});

/** Changed tokens' spans; neighbours apart only by spaces join into one. */
const spansOf = (line: TokenLine, changed: ReadonlyArray<LineToken>): Array<Span> => {
  const spans: Array<Span> = [];

  for (const token of changed) {
    const span = { start: token.col, end: token.col + token.text.length };
    const last = spans.at(-1);

    if (last !== undefined && line.text.slice(last.end, span.start).trim() === "") {
      spans[spans.length - 1] = { start: last.start, end: span.end };
    } else {
      spans.push(span);
    }
  }

  return spans;
};

const pairRow = (oldLine: TokenLine, newLine: TokenLine, old: number, nu: number): Row => {
  if (oldLine.text.length > MAX_TOKEN_DIFF_LINE || newLine.text.length > MAX_TOKEN_DIFF_LINE)
    return { kind: "modified", old, new: nu, removed: NONE, added: NONE };

  const a = oldLine.tokens;
  const b = newLine.tokens;

  const ops = myers(a.length, b.length, (i, j) => {
    const x = a[i];
    const y = b[j];

    return x !== undefined && y !== undefined && x.kind === y.kind && x.text === y.text;
  });

  const gone: Array<LineToken> = [];
  const fresh: Array<LineToken> = [];

  for (const op of ops) {
    const deleted = op.type === "delete" ? a[op.a] : undefined;
    const inserted = op.type === "insert" ? b[op.b] : undefined;

    if (deleted !== undefined) gone.push(deleted);

    if (inserted !== undefined) fresh.push(inserted);
  }

  const removed = spansOf(oldLine, gone);
  const added = spansOf(newLine, fresh);
  const kind = removed.length === 0 && added.length > 0 ? "inserted" : "modified";

  return { kind, old, new: nu, removed, added };
};

/** Rows for a run of deleted lines then inserted ones: paired in order, the rest whole. */
const changeRows = (
  oldLines: ReadonlyArray<TokenLine>,
  newLines: ReadonlyArray<TokenLine>,
  dels: ReadonlyArray<number>,
  ins: ReadonlyArray<number>
): Array<Row> => {
  const rows: Array<Row> = [];
  const paired = Math.min(dels.length, ins.length);

  for (let k = 0; k < paired; k++) {
    const old = dels[k] ?? 0;
    const nu = ins[k] ?? 0;
    const oldLine = oldLines[old];
    const newLine = newLines[nu];

    if (oldLine !== undefined && newLine !== undefined)
      rows.push(pairRow(oldLine, newLine, old, nu));
  }

  for (const old of dels.slice(paired)) rows.push(lineRow("removed", old, null));

  for (const nu of ins.slice(paired)) rows.push(lineRow("added", null, nu));

  return rows;
};

/** Every line of both files as rows, in order; throws `TooComplex` past `maxEdits` changed lines. */
export const alignLines = (
  oldLines: ReadonlyArray<TokenLine>,
  newLines: ReadonlyArray<TokenLine>,
  maxEdits?: number
): Array<Row> => {
  const ops = myers(
    oldLines.length,
    newLines.length,
    (i, j) => oldLines[i]?.fingerprint === newLines[j]?.fingerprint,
    maxEdits
  );

  const rows: Array<Row> = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];

    if (op?.type === "equal") {
      rows.push(lineRow("equal", op.a, op.b));
      i++;
      continue;
    }

    const dels: Array<number> = [];
    const ins: Array<number> = [];

    for (let cur = ops[i]; cur?.type === "delete"; cur = ops[++i]) dels.push(cur.a);

    for (let cur = ops[i]; cur?.type === "insert"; cur = ops[++i]) ins.push(cur.b);

    rows.push(...changeRows(oldLines, newLines, dels, ins));
  }

  return rows;
};
