/**
 * How the Editor's status row fits its width (DESIGN.md, Chrome redesign → Editor): the branch is
 * the only item that shrinks, in the middle, and Completions drops to its glyph before it does.
 */

export const ELLIPSIS = "…";

/** The share of the kept characters that stays at the front ("lucas/eng-499-desk…midnight"). */
const HEAD_SHARE = 0.6;

const cut = (text: string, kept: number) => {
  const head = Math.ceil(kept * HEAD_SHARE);

  return `${text.slice(0, head)}${ELLIPSIS}${text.slice(text.length - (kept - head))}`;
};

/**
 * The longest prefix…tail of `text` whose width fits `room`, measured by `width`; the whole text
 * when it fits, and just the ellipsis when nothing else does.
 */
export const middleTruncate = (
  text: string,
  room: number,
  width: (candidate: string) => number
): string => {
  if (width(text) <= room) return text;
  let low = 0;
  let high = text.length - 1;

  // Widths only grow with the characters kept, so the longest fit is a binary search.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (width(cut(text, mid)) <= room) low = mid;
    else high = mid - 1;
  }

  return low === 0 ? ELLIPSIS : cut(text, low);
};

export interface StatusFitInput {
  /** The row's width for the branch once every other item has its natural width. */
  readonly room: number;
  /** The branch's natural width. */
  readonly branch: number;
  /** The width Completions gives back by dropping its label for its glyph. */
  readonly completionsLabel: number;
}

export interface StatusFit {
  readonly completions: "label" | "glyph";
  /** The branch's width cap, or null when it shows in full. */
  readonly branchRoom: number | null;
}

export const statusFit = ({ room, branch, completionsLabel }: StatusFitInput): StatusFit => {
  if (branch <= room) return { completions: "label", branchRoom: null };

  const glyphRoom = room + completionsLabel;

  return {
    completions: "glyph",
    branchRoom: branch <= glyphRoom ? null : Math.max(0, glyphRoom),
  };
};
