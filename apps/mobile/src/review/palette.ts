/**
 * The diff's colours on Midnight: DESIGN.md's diff fills over `surface-sunken`, or the colourblind
 * (`-cvd`) blue and orange pair with its own text colours. Fills are blended to opaque colours
 * up front, so a line needs one background and no overlay.
 */
import { midnight } from "@polaris/ui/tokens";

export interface DiffPalette {
  readonly addedText: string;
  readonly removedText: string;
  readonly addedBg: string;
  readonly removedBg: string;
}

const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** `colour` at `alpha` (0–1) over the opaque `ground`, as an opaque `#rrggbb`. */
export const over = (colour: string, alpha: number, ground: string): string => {
  const top = channels(colour);
  const under = channels(ground);

  return `#${top
    .map((c, i) => Math.round(c * alpha + (under[i] ?? 0) * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
};

/** DESIGN.md: line fills at about 10%. */
const FILL = 0.1;

export const diffPalette = (colourblind: boolean): DiffPalette =>
  colourblind
    ? {
        addedText: midnight.diffAddedCvdText,
        removedText: midnight.diffRemovedCvdText,
        addedBg: over(midnight.diffAddedCvd, FILL, midnight.surfaceSunken),
        removedBg: over(midnight.diffRemovedCvd, FILL, midnight.surfaceSunken),
      }
    : {
        addedText: midnight.diffAddedText,
        removedText: midnight.diffRemovedText,
        addedBg: over(midnight.diffAdded, FILL, midnight.surfaceSunken),
        removedBg: over(midnight.diffRemoved, FILL, midnight.surfaceSunken),
      };
