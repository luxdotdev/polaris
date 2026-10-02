/**
 * Line numbers while a proposal shows (Paper E2): they describe the file after Accept. Removed
 * lines have none, added lines take the new numbers, and the lines below move by the difference.
 */
import type { Hunk } from "./patch.ts";

export interface AddedNumbers {
  /** The old line the added lines follow (0: the top), as in `Hunk.line` for an insertion. */
  readonly after: number;
  /** The new number of the first added line. */
  readonly first: number;
  readonly count: number;
}

export interface Numbering {
  /** Old lines shown removed, unnumbered. */
  readonly removed: ReadonlySet<number>;
  /** From each old line on (ascending), how far numbers move. */
  readonly shifts: ReadonlyArray<{ readonly from: number; readonly delta: number }>;
  readonly added: ReadonlyArray<AddedNumbers>;
}

/** `hunks` in document order. */
export const numbering = (hunks: ReadonlyArray<Hunk>): Numbering => {
  const removed = new Set<number>();
  const shifts: Array<{ readonly from: number; readonly delta: number }> = [];
  const added: Array<AddedNumbers> = [];
  let delta = 0;

  for (const hunk of hunks) {
    for (let n = 0; n < hunk.removed.length; n++) removed.add(hunk.line + n);
    // Additions follow the last removed line, or the line an insertion names.
    const after = hunk.removed.length === 0 ? hunk.line : hunk.line + hunk.removed.length - 1;
    // The first added line takes the number the first removed (or next) line had, moved.
    const start = hunk.removed.length === 0 ? hunk.line + 1 : hunk.line;

    if (hunk.added.length > 0)
      added.push({ after, first: start + delta, count: hunk.added.length });
    delta += hunk.added.length - hunk.removed.length;
    shifts.push({ from: after + 1, delta });
  }

  return { removed, shifts, added };
};

/** The number old line `line` shows, or null when it is removed. */
export const shownNumber = (numbers: Numbering, line: number): number | null => {
  if (numbers.removed.has(line)) return null;
  let delta = 0;

  for (const shift of numbers.shifts) {
    if (shift.from > line) break;
    delta = shift.delta;
  }

  return line + delta;
};
