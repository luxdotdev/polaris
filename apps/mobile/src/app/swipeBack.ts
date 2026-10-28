/** The edge swipe that leaves a pushed screen, as iOS's own: when it starts and when it commits. */

/** How far from the left edge, in points, a swipe back may start. */
export const EDGE = 24;

/** A horizontal move to the right that began at the left edge. */
export const startsSwipeBack = (x0: number, dx: number, dy: number): boolean =>
  x0 <= EDGE && dx > 8 && Math.abs(dy) < dx;

/** Past a third of the width, or flicked right, it goes back; otherwise the screen returns. */
export const commitsSwipeBack = (dx: number, vx: number, width: number): boolean =>
  vx > 0.5 ? dx > 0 : dx > width / 3;
