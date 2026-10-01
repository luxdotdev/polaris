/**
 * Which lines a change added, from `git diff -U0`: the Rules report only
 * Findings on them (docs/research/rules-layer.md §4). A Finding is kept when
 * its range overlaps an added range, so a multi-line match survives when only
 * one of its lines changed.
 */
import { runGit } from "../git/git.ts";

/** 1-based, inclusive ranges of added lines per path (the new side of the diff). */
export type AddedLines = ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>;

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** C-style escapes git uses in quoted paths, as byte values. */
const ESCAPES = new Map([
  ["n", 10],
  ["t", 9],
  ["r", 13],
  ['"', 34],
  ["\\", 92],
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["v", 11],
]);

/** Unquotes a path git printed in C style (`"a\tb"`, octal escapes for non-ASCII bytes). */
const unquote = (raw: string): string => {
  if (!raw.startsWith('"')) return raw;

  const bytes: Array<number> = [];
  const body = raw.slice(1, -1);
  const encoder = new TextEncoder();

  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;

    if (c !== "\\") {
      bytes.push(...encoder.encode(c));
      continue;
    }

    const next = body[i + 1] ?? "";

    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(ESCAPES.get(next) ?? next.charCodeAt(0));
      i += 1;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
};

interface ParseState {
  readonly added: Map<string, Array<readonly [number, number]>>;
  ranges: Array<readonly [number, number]> | null;
  /** Content lines left in the current hunk: inside one, `+++ x` is an added line, not a header. */
  remaining: number;
}

const parseLine = (state: ParseState, line: string) => {
  if (state.remaining > 0) {
    if (!line.startsWith("\\")) state.remaining -= 1;

    return;
  }

  if (line.startsWith("+++ ")) {
    const path = line.slice(4);
    state.ranges = path === "/dev/null" ? null : [];

    if (state.ranges !== null) state.added.set(unquote(path), state.ranges);

    return;
  }

  const hunk = HUNK.exec(line);

  if (hunk === null) return;
  const removed = hunk[1] === undefined ? 1 : Number(hunk[1]);
  const start = Number(hunk[2]);
  const count = hunk[3] === undefined ? 1 : Number(hunk[3]);
  state.remaining = removed + count;

  if (count > 0) state.ranges?.push([start, start + count - 1]);
};

/** Parses `git diff -U0 --no-prefix` output into added ranges; deleted files are absent. */
export const parseAddedLines = (diff: string): AddedLines => {
  const state: ParseState = { added: new Map(), ranges: null, remaining: 0 };

  for (const line of diff.split("\n")) parseLine(state, line);

  for (const [path, list] of state.added) if (list.length === 0) state.added.delete(path);

  return state.added;
};

/** True when lines `start..end` (1-based, inclusive) touch an added line of `path`. */
export const overlapsAdded = (added: AddedLines, path: string, start: number, end: number) =>
  (added.get(path) ?? []).some(([a, b]) => start <= b && end >= a);

/**
 * The lines `head` adds over `base` (commits or trees). Renames count as
 * their new path; binary files have no hunks and drop out.
 */
export const addedLines = async (cwd: string, base: string, head: string): Promise<AddedLines> => {
  const { stdout } = await runGit(cwd, [
    "-c",
    "core.quotePath=true",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-prefix",
    "--diff-filter=AMR",
    "-M",
    base,
    head,
    "--",
  ]);

  return parseAddedLines(new TextDecoder().decode(stdout));
};
