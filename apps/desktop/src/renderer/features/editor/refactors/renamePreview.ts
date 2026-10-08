/**
 * The multi-file rename preview's reading of a refactor preview (DESIGN.md, Editor: Language
 * refactors; Paper L7): each file's changed lines as hunks, from its original and projected text.
 */
import type { Preview } from "./coordinator.ts";

export interface DiffLine {
  /** 1-based line number in its own text. */
  readonly line: number;
  readonly text: string;
}

export interface Hunk {
  /** The first changed line, in the original text. */
  readonly line: number;
  readonly removed: readonly DiffLine[];
  readonly added: readonly DiffLine[];
}

export interface RenameFile {
  readonly path: string;
  readonly name: string;
  /** The folder relative to the checkout's root ("daemon/src/hosts"); "" at the root. */
  readonly folder: string;
  /** The file had unsaved edits before; the rename lands on top of them. */
  readonly unsaved: boolean;
  readonly hunks: readonly Hunk[];
}

const lines = (text: string) => text.split(/\r?\n/);

const prefixLength = (a: readonly string[], b: readonly string[]) => {
  let n = 0;

  while (n < a.length && n < b.length && a[n] === b[n]) n++;

  return n;
};

const suffixLength = (a: readonly string[], b: readonly string[], prefix: number) => {
  let n = 0;

  while (
    n < a.length - prefix &&
    n < b.length - prefix &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;

  return n;
};

const numbered = (all: readonly string[], from: number, to: number): DiffLine[] =>
  all.slice(from, to).map((text, index) => ({ line: from + index + 1, text }));

/** Pairs changed lines when the line counts match (a rename never adds lines), else one block. */
export const hunksOf = (before: string, after: string): Hunk[] => {
  const a = lines(before);
  const b = lines(after);
  const prefix = prefixLength(a, b);
  const suffix = suffixLength(a, b, prefix);
  const aEnd = a.length - suffix;
  const bEnd = b.length - suffix;

  if (aEnd - prefix !== bEnd - prefix)
    return prefix === aEnd && prefix === bEnd
      ? []
      : [
          {
            line: prefix + 1,
            removed: numbered(a, prefix, aEnd),
            added: numbered(b, prefix, bEnd),
          },
        ];

  const hunks: Hunk[] = [];
  let start = -1;

  for (let index = prefix; index <= aEnd; index++) {
    const changed = index < aEnd && a[index] !== b[index];

    if (changed && start === -1) start = index;

    if (!changed && start !== -1) {
      hunks.push({
        line: start + 1,
        removed: numbered(a, start, index),
        added: numbered(b, start, index),
      });
      start = -1;
    }
  }

  return hunks;
};

const relative = (path: string, root: string) =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

export const renameFiles = (preview: Preview, root: string): RenameFile[] =>
  preview.touched.flatMap((path) => {
    const original = preview.originals.find((doc) => doc.canonicalPath === path);
    const next = preview.documents.find((doc) => doc.canonicalPath === path);

    if (original === undefined || next === undefined) return [];
    const inRoot = relative(path, root);
    const slash = inRoot.lastIndexOf("/");

    return [
      {
        path,
        name: inRoot.slice(slash + 1),
        folder: slash === -1 ? "" : inRoot.slice(0, slash),
        unsaved: original.dirty,
        hunks: hunksOf(original.text, next.text),
      },
    ];
  });

/** "Rename BASE_DELAY_MS to RETRY_DELAY_MS", split so the names can take the code face. */
export const renameNames = (label: string) => {
  const match = /^Rename (\S+) to (\S+)$/.exec(label);

  return match === null ? null : { from: match[1] ?? "", to: match[2] ?? "" };
};

export const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** "lines 31 and 44", "lines 31, 44 and 60", "lines 31, 44, 60 and others". */
export const linesPhrase = (hunks: readonly Hunk[]) => {
  const numbers = hunks.map((hunk) => String(hunk.line));

  if (numbers.length === 1) return `line ${numbers[0]}`;

  if (numbers.length <= 3) return `lines ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;

  return `lines ${numbers.slice(0, 3).join(", ")} and others`;
};

/** A file shows up to two hunks; with more, its first, then "N more changes" to open the rest. */
export const visibleHunks = (hunks: readonly Hunk[], expanded: boolean) =>
  expanded || hunks.length <= 2 ? hunks : hunks.slice(0, 1);
