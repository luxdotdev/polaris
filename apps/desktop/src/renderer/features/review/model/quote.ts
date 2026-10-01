/**
 * The code a selection covers, read from Pierre's parsed diff: a comment quotes it in an
 * Agent Session's feedback, and "Suggest change" starts from it.
 */
import type { FileDiffMetadata } from "@pierre/diffs";

type Side = "new" | "old";

/** The text of line `n` on one side, or undefined when the diff doesn't hold it. */
const lineAt = (diff: FileDiffMetadata, side: Side, n: number): string | undefined => {
  const lines = side === "new" ? diff.additionLines : diff.deletionLines;

  if (!diff.isPartial) return lines[n - 1];

  for (const hunk of diff.hunks) {
    const start = side === "new" ? hunk.additionStart : hunk.deletionStart;
    const count = side === "new" ? hunk.additionCount : hunk.deletionCount;
    const index = side === "new" ? hunk.additionLineIndex : hunk.deletionLineIndex;

    if (n >= start && n < start + count) return lines[index + (n - start)];
  }

  return undefined;
};

/** Lines `start`–`end` (1-based, inclusive) without their line endings; lines the diff lacks are skipped. */
export const quoteLines = (diff: FileDiffMetadata, side: Side, start: number, end: number) => {
  const out: Array<string> = [];

  for (let n = start; n <= end; n += 1) {
    const line = lineAt(diff, side, n);

    if (line !== undefined) out.push(line.replace(/\r?\n$/, ""));
  }

  return out.join("\n");
};
