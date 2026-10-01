/**
 * The risk column's file list (Paper R1 1XP-0): files still to view in Review order, then
 * one "+ N viewed files" row that opens the viewed ones under it.
 */
import type { ReviewFile } from "./layout.ts";

export type FileListRow =
  | { readonly kind: "file"; readonly file: ReviewFile; readonly viewed: boolean }
  | { readonly kind: "viewed"; readonly count: number; readonly open: boolean };

export const fileListRows = (
  files: ReadonlyArray<ReviewFile>,
  viewed: (file: ReviewFile) => boolean,
  showViewed: boolean
): ReadonlyArray<FileListRow> => {
  const done = files.filter(viewed);

  const rows = files.flatMap((file): Array<FileListRow> =>
    viewed(file) ? [] : [{ kind: "file", file, viewed: false }]
  );

  if (done.length === 0) return rows;

  rows.push({ kind: "viewed", count: done.length, open: showViewed });

  if (showViewed) for (const file of done) rows.push({ kind: "file", file, viewed: true });

  return rows;
};
