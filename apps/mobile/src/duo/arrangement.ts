/**
 * What the shell draws for a posture and the route on top (DESIGN.md, iPhone Duo). The route
 * never changes with the posture: folding, half-folding and unfolding only rearrange it, so the
 * focus stays where it was. Pure.
 */
import type { Route } from "../app/route.ts";
import type { Posture, Rect } from "./posture.ts";

export type Arrangement =
  /** The iPhone app, unchanged. */
  | { readonly kind: "single" }
  /** D6: the thread in the first half, what it focuses in the second. */
  | { readonly kind: "context"; readonly first: Rect; readonly second: Rect }
  /** Unfolded on a screen with no second half of its own: it keeps the first half. */
  | { readonly kind: "aside"; readonly first: Rect; readonly second: Rect }
  /** D9: the constellation graph across both halves. */
  | { readonly kind: "span"; readonly division: Rect }
  /** D7: the thread above the fold, its composer and the keyboard below. */
  | { readonly kind: "laptop"; readonly bottom: Rect; readonly division: Rect }
  /** D8: the sky above the fold, needs you below. */
  | {
      readonly kind: "monitor";
      readonly top: Rect;
      readonly bottom: Rect;
      readonly division: Rect;
    };

const SINGLE: Arrangement = { kind: "single" };

export const arrangementOf = (posture: Posture, top: Route): Arrangement => {
  if (posture.kind === "folded") return SINGLE;

  if (posture.kind === "halfFolded") {
    if (top.screen === "thread")
      return { kind: "laptop", bottom: posture.bottom, division: posture.division };

    return top.screen === "tabs"
      ? { kind: "monitor", top: posture.top, bottom: posture.bottom, division: posture.division }
      : SINGLE;
  }

  if (top.screen === "thread")
    return { kind: "context", first: posture.first, second: posture.second };

  if (top.screen === "constellation") return { kind: "span", division: posture.division };

  return { kind: "aside", first: posture.first, second: posture.second };
};

/**
 * The laptop's composer area: from the fold down to the keyboard (or the home indicator), so the
 * transcript ends at the fold and the composer sits under it.
 */
export const composerMinHeight = (
  bottom: Rect,
  division: Rect,
  keyboard: number,
  bottomInset: number
): number => Math.max(0, bottom.height + division.height - Math.max(keyboard, bottomInset));
