/**
 * The change the Reviewer judges: one unified diff of `base..head` (commits or
 * trees) and, per file, the line ranges its hunks show, which decide whether a
 * Finding's lines are "in the diff".
 */
import type { LineRange } from "@polaris/protocol";
import { checkoutGit } from "../git/review/refs.ts";

export interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
}

export interface DiffFile {
  /** The path at `head`; the old path for a deleted file. */
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  /** The file's part of the unified diff, header included. */
  readonly patch: string;
}

export interface ChangeDiff {
  readonly files: ReadonlyArray<DiffFile>;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const count = (text: string | undefined) => (text === undefined ? 1 : Number(text));

const pathOf = (header: ReadonlyArray<string>): string | null => {
  const plus = header.find((line) => line.startsWith("+++ "));
  const minus = header.find((line) => line.startsWith("--- "));
  const strip = (line: string) => line.slice(4).replace(/^[ab]\//, "");

  if (plus !== undefined && plus !== "+++ /dev/null") return strip(plus);

  if (minus !== undefined && minus !== "--- /dev/null") return strip(minus);
  const git = header[0]?.match(/^diff --git a\/.+ b\/(.+)$/);

  return git?.[1] ?? null;
};

const parseFile = (lines: ReadonlyArray<string>): DiffFile | null => {
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  const path = pathOf(header);

  if (path === null) return null;
  const hunks: Array<Hunk> = [];

  for (const line of lines) {
    const match = HUNK.exec(line);

    if (match === null) continue;
    hunks.push({
      oldStart: Number(match[1]),
      oldLines: count(match[2]),
      newStart: Number(match[3]),
      newLines: count(match[4]),
    });
  }

  return { path, hunks, patch: lines.join("\n") };
};

/** Split a unified diff into its files. */
export const parseDiff = (patch: string): ChangeDiff => {
  const files: Array<DiffFile> = [];
  let current: Array<string> = [];

  const flush = () => {
    const file = current.length > 0 ? parseFile(current) : null;

    if (file !== null) files.push(file);
    current = [];
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) flush();
    current.push(line);
  }

  flush();

  return { files };
};

/** The diff of `base..head` in a checkout, renames detected, three lines of context. */
export const readDiff = async (cwd: string, base: string, head: string): Promise<ChangeDiff> =>
  parseDiff(
    await checkoutGit(cwd, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", base, head])
  );

/** True when `lines` overlap a hunk of `path` on their side. */
export const inDiff = (diff: ChangeDiff, path: string, lines: LineRange): boolean => {
  const file = diff.files.find((f) => f.path === path);

  if (file === undefined) return false;

  return file.hunks.some((hunk) => {
    const start = lines.side === "new" ? hunk.newStart : hunk.oldStart;
    const length = lines.side === "new" ? hunk.newLines : hunk.oldLines;

    return length > 0 && lines.start <= start + length - 1 && lines.end >= start;
  });
};
