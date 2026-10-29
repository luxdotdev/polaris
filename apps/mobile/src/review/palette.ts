/**
 * The diff's colours in the current theme: DESIGN.md's diff fills over the panel, or the colourblind
 * (`-cvd`) blue and orange pair with its own text colours. Fills are blended to opaque colours
 * up front, so a line needs one background and no overlay.
 */
import type { MobileColours } from "../theme/index.ts";

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

export const diffPalette = (colours: MobileColours, colourblind: boolean): DiffPalette =>
  colourblind
    ? {
        addedText: colours.diffAddedCvdText,
        removedText: colours.diffRemovedCvdText,
        addedBg: over(colours.diffAddedCvd, FILL, colours.panel),
        removedBg: over(colours.diffRemovedCvd, FILL, colours.panel),
      }
    : {
        addedText: colours.diffAddedText,
        removedText: colours.diffRemovedText,
        addedBg: over(colours.diffAdded, FILL, colours.panel),
        removedBg: over(colours.diffRemoved, FILL, colours.panel),
      };
