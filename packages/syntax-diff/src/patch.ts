/**
 * Rows as a unified patch a renderer can parse against the two full files (Pierre's
 * `processFile`), with the token spans to emphasise. An insertion within a line is a context
 * line in the patch: one row, the new tokens marked, nothing removed.
 */
import type { Row } from "./align.ts";

export interface Emphasis {
  readonly side: "old" | "new";
  /** 1-based, on its side. */
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export interface SyntaxPatch {
  /** Empty when nothing but spacing changed. */
  readonly patch: string;
  readonly emphasis: ReadonlyArray<Emphasis>;
  /** New-side line numbers (1-based) of insertions within a line, shown as context rows. */
  readonly inserted: ReadonlyArray<number>;
}

const isChange = (row: Row) => row.kind !== "equal";

/** Which rows a hunk shows: each change and `context` rows either side of it. */
const visibleRows = (rows: ReadonlyArray<Row>, context: number) => {
  const visible = Array.from<boolean>({ length: rows.length }).fill(false);

  rows.forEach((row, i) => {
    if (!isChange(row)) return;

    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++)
      visible[j] = true;
  });

  return visible;
};

interface Lines {
  readonly old: ReadonlyArray<string>;
  readonly new: ReadonlyArray<string>;
}

/** git's header numbers: a side with no lines starts at the line before the hunk. */
const range = (before: number, count: number) => `${count === 0 ? before : before + 1},${count}`;

const hunkText = (rows: ReadonlyArray<Row>, lines: Lines, before: { old: number; new: number }) => {
  const body: Array<string> = [];
  let minus: Array<string> = [];
  let plus: Array<string> = [];

  const flush = () => {
    body.push(...minus, ...plus);
    minus = [];
    plus = [];
  };

  for (const row of rows) {
    if (row.kind === "equal" || row.kind === "inserted") {
      flush();
      body.push(` ${lines.new[row.new ?? 0] ?? ""}`);
      continue;
    }

    if (row.old !== null) minus.push(`-${lines.old[row.old] ?? ""}`);

    if (row.new !== null) plus.push(`+${lines.new[row.new] ?? ""}`);
  }

  flush();
  const oldCount = rows.filter((r) => r.old !== null).length;
  const newCount = rows.filter((r) => r.new !== null).length;

  return `@@ -${range(before.old, oldCount)} +${range(before.new, newCount)} @@\n${body.join("\n")}\n`;
};

const emphasisOf = (rows: ReadonlyArray<Row>): Array<Emphasis> =>
  rows.flatMap((row) => [
    ...row.removed.map((s) => ({ side: "old" as const, line: (row.old ?? 0) + 1, ...s })),
    ...row.added.map((s) => ({ side: "new" as const, line: (row.new ?? 0) + 1, ...s })),
  ]);

/** The patch of `rows` between files named `name`, with `context` unchanged lines around changes. */
export const toPatch = (
  rows: ReadonlyArray<Row>,
  lines: Lines,
  name: string,
  context = 3
): SyntaxPatch => {
  const visible = visibleRows(rows, context);
  const hunks: Array<string> = [];
  const before = { old: 0, new: 0 };
  let i = 0;

  while (i < rows.length) {
    let j = i;

    while (j < rows.length && visible[j] === visible[i]) j++;
    const slice = rows.slice(i, j);

    if (visible[i] === true) hunks.push(hunkText(slice, lines, before));
    before.old += slice.filter((r) => r.old !== null).length;
    before.new += slice.filter((r) => r.new !== null).length;
    i = j;
  }

  return {
    patch: hunks.length === 0 ? "" : `--- a/${name}\n+++ b/${name}\n${hunks.join("")}`,
    emphasis: emphasisOf(rows),
    inserted: rows.flatMap((r) => (r.kind === "inserted" && r.new !== null ? [r.new + 1] : [])),
  };
};
