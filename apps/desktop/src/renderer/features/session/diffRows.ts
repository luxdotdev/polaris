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

/** The tab stop `white-space: pre` uses (CSS `tab-size`'s default). */
const TAB_SIZE = 8;

// East Asian wide and fullwidth ranges and emoji drawn as emoji: two monospace cells each.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u;

/** The monospace cells a line takes unwrapped: tabs to their stop, wide characters as two. */
export const lineColumns = (text: string): number => {
  let columns = 0;

  for (const char of text) {
    if (char === "\t") columns += TAB_SIZE - (columns % TAB_SIZE);
    else columns += WIDE.test(char) ? 2 : 1;
  }

  return columns;
};

/** A file's widest line in cells: how far its card scrolls sideways. */
export const fileColumns = (file: DiffFile): number =>
  file.hunks.reduce(
    (widest, hunk) =>
      hunk.lines.reduce((wide, line) => Math.max(wide, lineColumns(line.text)), widest),
    0
  );
