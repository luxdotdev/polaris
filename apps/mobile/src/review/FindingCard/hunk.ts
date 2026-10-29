/** The diff hunk shown inline under a finding (Paper MX-N): its file's hunk covering the flagged lines. */
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { RiskFinding } from "@polaris/protocol";
import type { DiffFileInput } from "../diffRows.ts";

export interface FindingHunk {
  /** An index into the files, for opening the file full screen. */
  readonly index: number;
  readonly file: FileDiffMetadata;
  readonly hunk: Hunk;
}

const span = (hunk: Hunk, side: "new" | "old") =>
  side === "new"
    ? { start: hunk.additionStart, end: hunk.additionStart + Math.max(hunk.additionCount, 1) - 1 }
    : { start: hunk.deletionStart, end: hunk.deletionStart + Math.max(hunk.deletionCount, 1) - 1 };

/** The first hunk overlapping the finding's lines on its side; null for a path the diff lacks. */
export const findingHunk = (
  files: ReadonlyArray<DiffFileInput>,
  finding: RiskFinding
): FindingHunk | null => {
  const index = files.findIndex((f) => f.diff.name === finding.path);
  const file = files[index]?.diff;

  if (file === undefined) return null;
  const { start, end, side } = finding.lines;

  const hunk = file.hunks.find((h) => {
    const range = span(h, side);

    return range.start <= end && start <= range.end;
  });

  return hunk === undefined ? null : { index, file, hunk };
};
