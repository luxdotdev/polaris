/**
 * The risk column's file list (Paper R1 1XP-0): files still to view in Review order, then
 * one "+ N viewed files" row that opens the viewed ones under it, then "+ N generated" for
 * lockfiles and generated files, viewed or not, which stay out of Viewed progress, then
 * the "Hide tests" row (R10): "+ N tests hidden" while hidden, "Hide N tests" while shown.
 */
import type { ReviewFile } from "./layout.ts";
import { progressOf, type ViewedProgress } from "./viewed.ts";

/** A row standing for a group of files until opened. */
export type Fold = "viewed" | "generated" | "tests";

/** The test files "Hide tests" covers, and whether they are hidden now. */
export interface TestsFold {
  readonly count: number;
  readonly hidden: boolean;
}

export type FileListRow =
  | { readonly kind: "file"; readonly file: ReviewFile; readonly viewed: boolean }
  | { readonly kind: "fold"; readonly fold: Fold; readonly count: number; readonly open: boolean };

export const fileListRows = (
  files: ReadonlyArray<ReviewFile>,
  viewed: (file: ReviewFile) => boolean,
  open: ReadonlySet<Fold>,
  tests: TestsFold | null = null
): ReadonlyArray<FileListRow> => {
  const rows: Array<FileListRow> = [];
  const reviewed = files.filter((f) => !f.generated);

  const fold = (kind: Fold, folded: ReadonlyArray<ReviewFile>) => {
    if (folded.length === 0) return;
    rows.push({ kind: "fold", fold: kind, count: folded.length, open: open.has(kind) });

    if (open.has(kind))
      for (const file of folded) rows.push({ kind: "file", file, viewed: viewed(file) });
  };

  for (const file of reviewed) if (!viewed(file)) rows.push({ kind: "file", file, viewed: false });

  fold("viewed", reviewed.filter(viewed));
  fold(
    "generated",
    files.filter((f) => f.generated)
  );

  if (tests !== null && tests.count > 0)
    rows.push({ kind: "fold", fold: "tests", count: tests.count, open: !tests.hidden });

  return rows;
};

/** "3 of 7 viewed", generated files left out. */
export const reviewProgress = (
  files: ReadonlyArray<ReviewFile>,
  viewed: (file: ReviewFile) => boolean
): ViewedProgress => {
  const counted = files.filter((f) => !f.generated);

  return progressOf(counted.filter(viewed).length, counted.length);
};
