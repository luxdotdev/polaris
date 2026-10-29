/**
 * How the Editor's status row fits its width (DESIGN.md, Chrome redesign → Editor): Completions
 * drops to its glyph, the branch shrinks in the middle, then the Host name at its end.
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
  /** The row's width for the branch once every other item (the Host whole) has its natural width. */
  readonly room: number;
  /** The branch's natural width. */
  readonly branch: number;
  /** The width Completions gives back by dropping its label for its glyph. */
  readonly completionsLabel: number;
  /** The Host name's natural width. */
  readonly host: number;
}

export interface StatusFit {
  readonly completions: "label" | "glyph";
  /** The branch's width cap, or null when it shows in full. */
  readonly branchRoom: number | null;
  /** The Host name's width cap, or null when it shows in full. */
  readonly hostRoom: number | null;
  /** The width still missing with the branch at nothing and the Host name at its floor. */
  readonly short: number;
}

/** The branch shrinks to this before the Host name gives way ("lucas/eng…vim"). */
export const BRANCH_FLOOR = 96;

/** The Host name keeps this much ("build-farm-e…") once the branch is at its floor. */
export const HOST_FLOOR = 80;

/**
 * What gives way, in order: Completions' label, the branch down to its floor, the Host name down
 * to its floor, then the branch to its ellipsis; `short` is what is still missing after that.
 */
export const statusFit = ({ room, branch, completionsLabel, host }: StatusFitInput): StatusFit => {
  if (branch <= room) return { completions: "label", branchRoom: null, hostRoom: null, short: 0 };

  const glyphRoom = room + completionsLabel;

  if (branch <= glyphRoom)
    return { completions: "glyph", branchRoom: null, hostRoom: null, short: 0 };
  const branchFloor = Math.min(branch, BRANCH_FLOOR);

  if (glyphRoom >= branchFloor)
    return { completions: "glyph", branchRoom: glyphRoom, hostRoom: null, short: 0 };
  const hostFloor = Math.min(host, HOST_FLOOR);
  const short = branchFloor - glyphRoom;

  if (host - short >= hostFloor)
    return { completions: "glyph", branchRoom: branchFloor, hostRoom: host - short, short: 0 };
  const left = glyphRoom + host - hostFloor;

  return {
    completions: "glyph",
    branchRoom: Math.max(0, left),
    hostRoom: host > hostFloor ? hostFloor : null,
    short: Math.max(0, -left),
  };
};

/** What leaves the row once nothing else can shrink, in this order; each is reachable elsewhere. */
export const DROP_ORDER = ["indent", "sync-counts", "latency"] as const;

export type StatusDrop = (typeof DROP_ORDER)[number];

/**
 * The items to drop, in `DROP_ORDER`, for the row to give back `over` px; `widths` holds each
 * item's width with its gap, 0 when the row doesn't show it.
 */
export const statusDrops = (
  over: number,
  widths: Readonly<Record<StatusDrop, number>>
): ReadonlyArray<StatusDrop> => {
  const dropped: StatusDrop[] = [];
  let left = over;

  for (const item of DROP_ORDER) {
    if (left <= 0) break;

    if (widths[item] > 0) {
      dropped.push(item);
      left -= widths[item];
    }
  }

  return dropped;
};
