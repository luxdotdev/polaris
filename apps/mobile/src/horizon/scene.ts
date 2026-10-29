/**
 * The horizon's geometry and palettes (Paper "Mobile chrome exploration", MX · Kit and MX-C), from
 * the shared 1440-wide art: a window of the art at 1:1 points, centred where Paper's 393 crop is.
 */
import { STARS } from "@polaris/ui/horizon";
import type { ThemeName } from "../theme";

/** The horizon's box: 60pt of scroll-edge fade over 140pt of sky, the ridges in its foot. */
export const HORIZON_HEIGHT = 200;

export const SKY_TOP = 60;

export const RIDGE_TOP = 128;

export const RIDGE_HEIGHT = 72;

const ART_WIDTH = 1440;

/** Paper's crop: its 393-wide frame shows the art from x 492. */
const PAPER_WIDTH = 393;

const PAPER_LEFT = 492;

const ART_CENTRE = PAPER_LEFT + PAPER_WIDTH / 2;

/** Where the screen's left edge falls in the art: a whole point, so its pixels stay square. */
export const cropLeft = (width: number): number =>
  Math.min(Math.max(Math.round(ART_CENTRE - width / 2), 0), Math.max(ART_WIDTH - width, 0));

/** The moon, 72pt square, 6pt in from the right and 58pt down the box (MX-C Moonlit). */
export const MOON_SIZE = 72;

export const MOON_TOP = 58;

export const moonLeft = (width: number): number => width - 6 - MOON_SIZE;

/** Paper places the Desktop's fixed sidebar stars 40pt in, and the rest by their share of 1440. */
const FIXED_STARS = 300;

const paperX = (x: number) =>
  x < FIXED_STARS ? x + 40 : Math.round((x / ART_WIDTH) * PAPER_WIDTH);

export interface Palette {
  readonly back: string;
  readonly front: string;
  /** The glow from the ridge up: its foot, then 45% of the way up; it fades out at the top. */
  readonly glow: readonly [string, string];
  readonly star: string;
  /** Moonlit dims its stars to 70% and keeps only the marked ones. */
  readonly starOpacity: number;
  readonly allStars: boolean;
  readonly moon: boolean;
}

export const PALETTES: Readonly<Record<ThemeName, Palette>> = {
  midnight: {
    back: "#151A3A",
    front: "#0B1026",
    glow: ["#465CBE29", "#465CBE0D"],
    star: "#BCD3FF",
    starOpacity: 1,
    allStars: true,
    moon: false,
  },
  moonlit: {
    back: "#262B45",
    front: "#1E2236",
    glow: ["#465CBE1F", "#465CBE0A"],
    star: "#BCD3FF",
    starOpacity: 0.7,
    allStars: false,
    moon: true,
  },
};

export interface PlacedStar {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
}

/** The theme's stars on a screen this wide, in the sky's box; ones past either edge are left out. */
export const starsFor = (theme: ThemeName, width: number): ReadonlyArray<PlacedStar> => {
  const palette = PALETTES[theme];
  const shift = PAPER_LEFT - cropLeft(width);

  return STARS.filter((star) => palette.allStars || star.moonlit)
    .map((star) => ({
      x: paperX(star.x) + shift,
      y: star.y,
      size: star.size,
      opacity: star.opacity * palette.starOpacity,
    }))
    .filter((star) => star.x >= 0 && star.x + star.size <= width);
};

/** "#rrggbbaa" as SVG's colour and opacity. */
export const splitHex = (hex: string) => ({
  color: hex.slice(0, 7),
  opacity: Number.parseInt(hex.slice(7, 9) || "ff", 16) / 255,
});
