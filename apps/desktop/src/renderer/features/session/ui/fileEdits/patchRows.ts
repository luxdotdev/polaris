/**
 * A `FilePatch`'s unified hunks as the rows an inline edit draws: the folded preview keeps only
 * changed lines, the open one every line with a gap between hunks and diff's no-newline notes.
 */
import type { FilePatch } from "@polaris/protocol";

export type PatchRow =
  | { readonly kind: "add" | "remove" | "context"; readonly text: string }
  | { readonly kind: "gap" }
  | { readonly kind: "no-newline" };

/** Changed lines the folded preview shows. */
export const PREVIEW_LINES = 8;

const NO_NEWLINE = "\\";

const rowOf = (line: string, first: boolean): PatchRow | null => {
  if (line.startsWith("@@")) return first ? null : { kind: "gap" };

  if (line.startsWith(NO_NEWLINE)) return { kind: "no-newline" };
  const text = line.slice(1);

  if (line.startsWith("+")) return { kind: "add", text };

  if (line.startsWith("-")) return { kind: "remove", text };

  return line.startsWith(" ") ? { kind: "context", text } : null;
};

/** Every row of the hunks, in order; the first hunk's header draws nothing. */
export const patchRows = (diff: string): ReadonlyArray<PatchRow> => {
  const rows: Array<PatchRow> = [];
  let hunks = 0;

  for (const line of diff.split("\n")) {
    const row = rowOf(line, hunks === 0);

    if (line.startsWith("@@")) hunks++;

    if (row !== null) rows.push(row);
  }

  return rows;
};

export const isLine = (row: PatchRow): row is Extract<PatchRow, { text: string }> =>
  row.kind === "add" || row.kind === "remove" || row.kind === "context";

export interface PatchView {
  /** What draws now: folded, the first changed lines; open, every row. */
  readonly rows: ReadonlyArray<PatchRow>;
  /** Code lines when open, for "Show all N lines". */
  readonly total: number;
  /** Opening shows more than the fold does. */
  readonly more: boolean;
}

/** The rows for a patch, folded or open. */
export const patchView = (all: ReadonlyArray<PatchRow>, open: boolean): PatchView => {
  const lines = all.filter(isLine);
  const changed = lines.filter((row) => row.kind !== "context");
  const folded = changed.slice(0, PREVIEW_LINES);

  return {
    rows: open ? all : folded,
    total: lines.length,
    more: lines.length > folded.length,
  };
};

/** What a change's row shows of its patch: lines, counts only, or nothing (no patch). */
export const patchShown = (patch: FilePatch | undefined): "lines" | "counts" | "none" => {
  if (patch === undefined) return "none";

  return patch.truncated || patch.diff === "" ? "counts" : "lines";
};
