/**
 * A file's diff as list rows for MX-Q (unified lines) or MX-R (split pairs): hunk headers, lines,
 * and each listed finding under the line it ends on. Nothing here touches React Native.
 */
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { RiskFinding, Severity } from "@polaris/protocol";
import {
  anchors,
  covers,
  hunkHeader,
  hunkLines,
  hunkPairs,
  type Line,
  type LinePair,
} from "../review/diffRows.ts";
import { highest, listedFindings } from "../review/model.ts";

export type Layout = "unified" | "split";

export type ScreenRow =
  | { readonly kind: "hunk"; readonly key: string; readonly header: string }
  | {
      readonly kind: "line";
      readonly key: string;
      readonly line: Line;
      readonly mark: Severity | null;
    }
  | {
      readonly kind: "pair";
      readonly key: string;
      readonly pair: LinePair;
      readonly mark: Severity | null;
    }
  | { readonly kind: "finding"; readonly key: string; readonly finding: RiskFinding };

const sides = (pair: LinePair) => [pair.old, pair.new].filter((l): l is Line => l !== null);

/** Rows of `hunks`; `findings` are the file's own, already listed and ranked. */
const rowsOf = (
  file: FileDiffMetadata,
  hunks: ReadonlyArray<Hunk>,
  findings: ReadonlyArray<RiskFinding>,
  layout: Layout
): Array<ScreenRow> => {
  const placed = new Set<string>();
  const rows: Array<ScreenRow> = [];

  const place = (lines: ReadonlyArray<Line>) => {
    for (const finding of findings) {
      if (placed.has(finding.id) || !lines.some((line) => anchors(finding, line))) continue;
      placed.add(finding.id);
      rows.push({ kind: "finding", key: `r:${finding.id}`, finding });
    }
  };

  const markOf = (lines: ReadonlyArray<Line>) =>
    highest(findings.flatMap((f) => (lines.some((l) => covers(f, l)) ? [f.severity] : [])));

  hunks.forEach((hunk, h) => {
    rows.push({ kind: "hunk", key: `h:${h}`, header: hunkHeader(hunk) });

    if (layout === "split") {
      hunkPairs(file, hunk).forEach((pair, i) => {
        rows.push({ kind: "pair", key: `p:${h}:${i}`, pair, mark: markOf(sides(pair)) });
        place(sides(pair));
      });

      return;
    }

    hunkLines(file, hunk).forEach((line, i) => {
      rows.push({ kind: "line", key: `l:${h}:${i}`, line, mark: markOf([line]) });
      place([line]);
    });
  });

  // A finding whose line the diff doesn't show still shows, above the first hunk.
  const unplaced = findings.flatMap((finding): Array<ScreenRow> =>
    placed.has(finding.id) ? [] : [{ kind: "finding", key: `r:${finding.id}`, finding }]
  );

  return [...unplaced, ...rows];
};

const own = (file: FileDiffMetadata, findings: ReadonlyArray<RiskFinding>) =>
  listedFindings(findings).filter((f) => f.path === file.name);

/** Every hunk of `file`, for the full-screen diff. */
export const fileRows = (
  file: FileDiffMetadata,
  findings: ReadonlyArray<RiskFinding>,
  layout: Layout
): ReadonlyArray<ScreenRow> => rowsOf(file, file.hunks, own(file, findings), layout);

/** One hunk, inline under a finding: only the findings it shows the line of. */
export const hunkRows = (
  file: FileDiffMetadata,
  hunk: Hunk,
  findings: ReadonlyArray<RiskFinding>
): ReadonlyArray<ScreenRow> => {
  const lines = hunkLines(file, hunk);
  const shown = own(file, findings).filter((f) => lines.some((l) => anchors(f, l)));

  return rowsOf(file, [hunk], shown, "unified");
};

/** What a file page says when it has no lines: a pure rename, a mode change, a binary file. */
export const noLinesNote = (file: FileDiffMetadata): string | null => {
  if (file.hunks.length > 0) return null;

  if (file.prevName !== undefined && file.prevName !== file.name)
    return `Renamed from ${file.prevName}. Its contents didn't change.`;

  if (file.prevMode !== undefined && file.mode !== undefined && file.prevMode !== file.mode)
    return `Mode changed from ${file.prevMode} to ${file.mode}. Its contents didn't change.`;

  return "No line changes to show. It may be a binary file.";
};

/** The largest line number `file` shows, for its gutter. */
export const largestNumber = (file: FileDiffMetadata): number =>
  Math.max(
    0,
    ...file.hunks.map(
      (h) => Math.max(h.deletionStart + h.deletionCount, h.additionStart + h.additionCount) - 1
    )
  );

/** Each hunk header's row index, for stepping between hunks. */
export const hunkStarts = (rows: ReadonlyArray<ScreenRow>): ReadonlyArray<number> =>
  rows.flatMap((row, i) => (row.kind === "hunk" ? [i] : []));
