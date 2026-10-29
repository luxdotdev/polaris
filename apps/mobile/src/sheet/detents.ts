/**
 * The instrument sheet's detents as pure numbers: which heights a sheet rests at, where a drag
 * released with a velocity settles, and the rubber band past the tallest detent. Every function
 * is a worklet, so the gesture calls them on the UI thread.
 */

/**
 * A resting height: `medium` (MX-H's 540 of 852, about five eighths of the room), `large` (the
 * room under the status bar), or a height in points.
 */
export type Detent = "medium" | "large" | number;

export interface SheetRoom {
  /** The height the sheet may cover: the window, less the keyboard while it is up. */
  readonly height: number;
  /** The safe area's top inset; the large detent stops this far plus a gap below the top. */
  readonly topInset: number;
}

/** Where a released drag settles: a detent's index in the resolved heights, or dismissed. */
export type Settle =
  | { readonly kind: "detent"; readonly index: number }
  | { readonly kind: "dismiss" };

export const DEFAULT_DETENTS: readonly Detent[] = ["medium", "large"];

/** MX-H's medium detent: 540pt of an 852pt window. */
export const MEDIUM_FRACTION = 540 / 852;

/** The gap between the status bar and a large sheet, as iOS leaves it. */
export const LARGE_GAP = 10;

/** A release faster than this (pt/s) moves one detent in its direction, whatever the distance. */
export const FLICK_VELOCITY = 500;

/** How far a release coasts, in seconds of its velocity (UIScrollView's normal deceleration). */
export const PROJECTION_SECONDS = 0.2;

/** UIScrollView's rubber-band constant. */
export const RUBBER_BAND = 0.55;

/** The tallest a sheet may be in this room. */
export const maxHeight = (room: SheetRoom): number => {
  "worklet";

  return Math.max(0, room.height - room.topInset - LARGE_GAP);
};

const heightOf = (detent: Detent, room: SheetRoom): number => {
  "worklet";

  const max = maxHeight(room);

  if (detent === "large") return max;

  if (detent === "medium") return Math.min(max, Math.round(room.height * MEDIUM_FRACTION));

  return Math.min(max, Math.max(0, detent));
};

/** The detents' heights in this room, ascending, without duplicates or empty ones. */
export const detentHeights = (detents: readonly Detent[], room: SheetRoom): number[] => {
  "worklet";

  const heights: number[] = [];

  for (const detent of detents) {
    const height = heightOf(detent, room);

    if (height > 0 && !heights.includes(height)) heights.push(height);
  }

  return heights.sort((a, b) => a - b);
};

/** Where a sheet comes to rest when it opens: its lowest detent. */
export const openingIndex = (heights: readonly number[]): number => {
  "worklet";

  return heights.length === 0 ? -1 : 0;
};

const nearest = (heights: readonly number[], to: number): Settle => {
  "worklet";

  let best: Settle = { kind: "dismiss" };
  let distance = Math.abs(to);

  heights.forEach((height, index) => {
    const gap = Math.abs(to - height);

    if (gap < distance) {
      best = { kind: "detent", index };
      distance = gap;
    }
  });

  return best;
};

const flicked = (heights: readonly number[], height: number, up: boolean): Settle => {
  "worklet";

  if (up) {
    const index = heights.findIndex((h) => h > height + 1);

    return { kind: "detent", index: index === -1 ? heights.length - 1 : index };
  }

  // A sheet stretched past its tallest detent flicks down from that detent, not from the stretch.
  const from = Math.min(height, heights[heights.length - 1] ?? height);
  const below = heights.filter((h) => h < from - 1);

  return below.length === 0 ? { kind: "dismiss" } : { kind: "detent", index: below.length - 1 };
};

/**
 * Where a drag released at `height` (the sheet's visible height) with `velocity` (pt/s, positive
 * downward, as the gesture reports it) settles. A flick steps one detent its way; a slow release
 * settles at the detent nearest where it would coast to, with zero standing for dismissal.
 */
export const settle = (
  heights: readonly number[],
  height: number,
  velocity: number,
  dismissible = true
): Settle => {
  "worklet";

  if (heights.length === 0) return { kind: "dismiss" };

  const target =
    Math.abs(velocity) >= FLICK_VELOCITY
      ? flicked(heights, height, velocity < 0)
      : nearest(heights, height - velocity * PROJECTION_SECONDS);

  return target.kind === "dismiss" && !dismissible ? { kind: "detent", index: 0 } : target;
};

/** How far past an edge a sheet shows when dragged `overshoot` beyond it, over a `span`. */
export const rubberBand = (overshoot: number, span: number): number => {
  "worklet";

  if (overshoot <= 0 || span <= 0) return 0;

  return (1 - 1 / ((overshoot * RUBBER_BAND) / span + 1)) * span;
};

/** The visible height a finger asks for, resisting past the tallest detent. */
export const dragHeight = (requested: number, tallest: number, room: SheetRoom): number => {
  "worklet";

  if (requested <= tallest) return Math.max(0, requested);

  return tallest + rubberBand(requested - tallest, room.height);
};
