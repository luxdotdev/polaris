/**
 * The changes F7 and ⇧F7 step through: each block of changed lines in a diff, and, in a
 * syntax-aware diff, each line that only gained tokens (shown as one unchanged row).
 */

export interface Stop {
  /** 1-based, on the side the row is drawn from. */
  readonly line: number;
  readonly side: "deletions" | "additions";
  /** 0-based new-side position, for order: a removal sits where it would have been. */
  readonly order: number;
}

interface Block {
  readonly type: "context" | "change";
  readonly additions?: number;
  readonly additionLineIndex: number;
  readonly deletionLineIndex: number;
}

export interface Hunks {
  readonly hunks: ReadonlyArray<{ readonly hunkContent: ReadonlyArray<Block> }>;
}

/** Every change block of `diff`, and the in-line insertions (1-based new lines), in order. */
export const stopsOf = (diff: Hunks, inserted: ReadonlyArray<number> = []): ReadonlyArray<Stop> => {
  const blocks = diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((block): Array<Stop> => {
      if (block.type !== "change") return [];

      return (block.additions ?? 0) > 0
        ? [{ line: block.additionLineIndex + 1, side: "additions", order: block.additionLineIndex }]
        : [
            {
              line: block.deletionLineIndex + 1,
              side: "deletions",
              order: block.additionLineIndex,
            },
          ];
    })
  );

  const lines = inserted.map((line): Stop => ({ line, side: "additions", order: line - 1 }));

  return [...blocks, ...lines].sort((a, b) => a.order - b.order);
};

/** The stop after (or before) `at`, wrapping; `at` is -1 before the first move. */
export const step = (count: number, at: number, direction: 1 | -1): number => {
  if (count === 0) return -1;

  if (at === -1) return direction === 1 ? 0 : count - 1;

  return (at + direction + count) % count;
};
