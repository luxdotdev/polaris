/**
 * The window's safe-area insets a half of the Duo has to keep clear of: only on the window edges
 * it touches, so the cover display's top-right cutout pads the half beside it and not the other.
 * Pure; `useEdgeInsets` reads the window.
 */
import type { Rect } from "./posture.ts";

export interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Within a point of the window's edge counts as touching it: halves are rounded to points. */
const touches = (edge: number, at: number) => Math.abs(edge - at) <= 1;

export const edgeInsets = (
  rect: Rect,
  window: { readonly width: number; readonly height: number },
  insets: Edges
): Edges => ({
  top: touches(rect.y, 0) ? insets.top : 0,
  right: touches(rect.x + rect.width, window.width) ? insets.right : 0,
  bottom: touches(rect.y + rect.height, window.height) ? insets.bottom : 0,
  left: touches(rect.x, 0) ? insets.left : 0,
});
