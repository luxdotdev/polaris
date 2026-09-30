/**
 * A parsed diff flattened into fixed-height rows for the virtualized Changes
 * list: each file is a header, its hunks and lines (unless folded) and a foot.
 */
import type { DiffFile, DiffLine } from "./model/diff.ts";

export type DiffRow =
  | {
      readonly kind: "file";
      readonly key: string;
      readonly file: DiffFile;
      readonly folded: boolean;
    }
  | { readonly kind: "hunk"; readonly key: string; readonly header: string }
  | { readonly kind: "line"; readonly key: string; readonly line: DiffLine }
  | { readonly kind: "note"; readonly key: string; readonly text: string }
  | { readonly kind: "foot"; readonly key: string }
  | { readonly kind: "gap"; readonly key: string };

export const ROW_HEIGHT: Record<DiffRow["kind"], number> = {
  file: 36,
  hunk: 24,
  line: 20,
  note: 28,
  foot: 6,
  gap: 12,
};

const fileBody = (file: DiffFile): ReadonlyArray<DiffRow> => {
  if (file.binary) return [{ kind: "note", key: `${file.path}:binary`, text: "Binary file" }];

  if (file.hunks.length === 0)
    return [{ kind: "note", key: `${file.path}:empty`, text: "No line changes" }];

  return file.hunks.flatMap((hunk, h) => [
    { kind: "hunk" as const, key: `${file.path}:${h}`, header: hunk.header },
    ...hunk.lines.map((line, n) => ({
      kind: "line" as const,
      key: `${file.path}:${h}:${n}`,
      line,
    })),
  ]);
};

export const diffRows = (
  files: ReadonlyArray<DiffFile>,
  folded: ReadonlySet<string>
): ReadonlyArray<DiffRow> =>
  files.flatMap((file, n) => {
    const isFolded = folded.has(file.path);
    const head: DiffRow = { kind: "file", key: `file:${file.path}`, file, folded: isFolded };
    const gap: ReadonlyArray<DiffRow> = n === 0 ? [] : [{ kind: "gap", key: `gap:${file.path}` }];

    if (isFolded) return [...gap, head];

    return [...gap, head, ...fileBody(file), { kind: "foot", key: `foot:${file.path}` }];
  });
