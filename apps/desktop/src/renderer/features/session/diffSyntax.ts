/**
 * Syntax colours for the Changes tab's lines. The diff has only hunks, so each hunk's new
 * side (context and added lines) and old side (context and removed lines) is highlighted on
 * its own, so nothing carries over a gap, and the rows map back to lines by their numbers.
 */
import {
  highlightLanguage,
  MAX_HIGHLIGHT_LINES,
  nextFrame,
} from "../editor/diff/data/highlightTokens.ts";
import { type HastNode, syntaxGroupOf } from "../editor/diff/model/highlightRuns.ts";
import type { DiffFile, DiffHunk, DiffLine } from "./model/diff.ts";

/** The moonlit theme's scope groups (`--color-syntax-*`), the editor's colours. */
export type SyntaxGroup = "keyword" | "string" | "type" | "function" | "comment" | "punctuation";

const GROUPS = new Map<string, SyntaxGroup>(
  (["keyword", "string", "type", "function", "comment", "punctuation"] as const).map((g) => [g, g])
);

/** A stretch of one line's text in one colour; null is plain code. */
export interface SyntaxRun {
  readonly text: string;
  readonly group: SyntaxGroup | null;
}

export type LineRuns = ReadonlyArray<SyntaxRun>;

/** One file's coloured lines, by side and line number. */
export interface FileSyntax {
  readonly old: ReadonlyMap<number, LineRuns>;
  readonly new: ReadonlyMap<number, LineRuns>;
}

/** The diff's coloured files by path; a file not in it stays plain. */
export type DiffSyntax = ReadonlyMap<string, FileSyntax>;

/** Highlights `text` as the file at `path`: one HAST row per line, or null. */
export type HighlightLines = (
  path: string,
  text: string
) => Promise<ReadonlyArray<HastNode> | null>;

const asGroup = (group: string | undefined): SyntaxGroup | null =>
  group === undefined ? null : (GROUPS.get(group) ?? null);

const collect = (node: HastNode, group: SyntaxGroup | null, runs: Array<SyntaxRun>) => {
  if (node.type === "text") {
    if (node.value !== undefined && node.value !== "") runs.push({ text: node.value, group });

    return;
  }

  const own =
    node.properties?.style === undefined ? group : asGroup(syntaxGroupOf(node.properties.style));

  for (const child of node.children ?? []) collect(child, own, runs);
};

/** Drops the row's own newline (an empty row is "\n"), so runs spell only the line. */
const withoutNewline = (runs: Array<SyntaxRun>): Array<SyntaxRun> => {
  const last = runs.at(-1);

  if (last === undefined || !last.text.endsWith("\n")) return runs;
  const text = last.text.slice(0, -1);

  return text === "" ? runs.slice(0, -1) : [...runs.slice(0, -1), { ...last, text }];
};

/**
 * A highlighted row's runs, or null unless they spell `source` exactly: a row the
 * highlighter cut or changed stays plain rather than shift a column.
 */
export const runsOfRow = (row: HastNode | undefined, source: string): LineRuns | null => {
  if (row === undefined) return null;
  const runs: Array<SyntaxRun> = [];

  for (const child of row.children ?? []) collect(child, null, runs);
  const line = withoutNewline(runs);

  return line.map((r) => r.text).join("") === source && line.some((r) => r.group !== null)
    ? line
    : null;
};

/** One side of a hunk: its line numbers and their text, in order. */
export interface HunkSide {
  readonly numbers: ReadonlyArray<number>;
  readonly lines: ReadonlyArray<string>;
}

const sideOf = (hunk: DiffHunk, number: (line: DiffLine) => number | null): HunkSide => {
  const numbers: Array<number> = [];
  const lines: Array<string> = [];

  for (const line of hunk.lines) {
    const n = number(line);

    if (n === null) continue;
    numbers.push(n);
    lines.push(line.text);
  }

  return { numbers, lines };
};

/** The hunk's old side (context and removed lines) and new side (context and added lines). */
export const hunkSides = (hunk: DiffHunk) => ({
  old: sideOf(hunk, (l) => l.oldNumber),
  new: sideOf(hunk, (l) => l.newNumber),
});

const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);

/** Whether a file gets colours: text in a language the highlighter knows, not past the limit. */
export const highlightable = (file: DiffFile) =>
  !file.binary &&
  file.hunks.length > 0 &&
  lineCount(file) <= MAX_HIGHLIGHT_LINES &&
  highlightLanguage(file.path) !== null;

/** Colours one hunk side into `into`, by its line numbers. */
const colourSide = async (
  highlight: HighlightLines,
  path: string,
  side: HunkSide,
  into: Map<number, LineRuns>
) => {
  if (side.lines.length === 0) return;
  const rows = await highlight(path, side.lines.join("\n"));

  if (rows === null) return;

  side.lines.forEach((source, i) => {
    const runs = runsOfRow(rows[i], source);
    const number = side.numbers[i];

    if (runs !== null && number !== undefined) into.set(number, runs);
  });

  // Mapping a long side is UI-thread work: give a frame its turn after each.
  if (side.lines.length > 200) await nextFrame();
};

/** A file's colours, hunk by hunk on each side; null when it stays plain. */
export const fileSyntax = async (
  file: DiffFile,
  highlight: HighlightLines
): Promise<FileSyntax | null> => {
  if (!highlightable(file)) return null;
  const old = new Map<number, LineRuns>();
  const fresh = new Map<number, LineRuns>();
  const oldPath = file.oldPath ?? file.path;

  await Promise.all(
    file.hunks.map(async (hunk) => {
      const sides = hunkSides(hunk);

      await colourSide(highlight, oldPath, sides.old, old);
      await colourSide(highlight, file.path, sides.new, fresh);
    })
  );

  return old.size === 0 && fresh.size === 0 ? null : { old, new: fresh };
};

/** A line's colours: removed lines on the old side, the rest on the new. */
export const lineSyntax = (
  syntax: DiffSyntax,
  path: string,
  line: DiffLine
): LineRuns | undefined => {
  const file = syntax.get(path);

  if (file === undefined) return undefined;

  return line.kind === "remove"
    ? file.old.get(line.oldNumber ?? -1)
    : file.new.get(line.newNumber ?? -1);
};
