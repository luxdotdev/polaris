/** The lines of one file that changed between two commits, from `git diff -U0`'s hunk headers. */
import { gitText } from "./git.ts";

/**
 * Lines `start` to `start + count - 1` of the old side changed; a `count` of 0 is an
 * insertion after line `start`.
 */
export interface LineSpan {
  readonly start: number;
  readonly count: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** The old-side spans of a unified diff's hunks. */
export const hunkSpans = (diff: string): ReadonlyArray<LineSpan> =>
  diff.split("\n").flatMap((line) => {
    const match = HUNK.exec(line);

    if (match === null) return [];

    return [{ start: Number(match[1]), count: match[2] === undefined ? 1 : Number(match[2]) }];
  });

/** `path` is relative to the repository's top, whatever directory `cwd` is in it. */
export const changedLines = async (options: {
  readonly cwd: string;
  readonly from: string;
  readonly to: string;
  readonly path: string;
}): Promise<ReadonlyArray<LineSpan>> =>
  hunkSpans(
    await gitText(options.cwd, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-U0",
      options.from,
      options.to,
      "--",
      `:(top,literal)${options.path}`,
    ])
  );
