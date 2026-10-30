/**
 * The Polaris star on a 16 grid (Paper MX-AH): its outer glow, rays and white core as pixel paths,
 * and the twinkle (MX-AK): the glow's pixels lit by the Working dither's cells, frame by frame.
 */
import { DITHER_CELL, DITHER_FRAMES, ditherFrameAt } from "@polaris/ui/dither";

export const STAR_GRID = 16;

const GLOW =
  "M0 7h3v2h-3zM13 7h3v2h-3zM7 0h2v3h-2zM7 13h2v3h-2zM3 3h1v1h-1zM4 4h1v1h-1zM5 5h1v1h-1zM12 3h1v1h-1zM11 4h1v1h-1zM10 5h1v1h-1zM3 12h1v1h-1zM4 11h1v1h-1zM5 10h1v1h-1zM12 12h1v1h-1zM11 11h1v1h-1zM10 10h1v1h-1zM3 6h2v1h-2zM3 9h2v1h-2zM11 6h2v1h-2zM11 9h2v1h-2zM6 3h1v2h-1zM9 3h1v2h-1zM6 11h1v2h-1zM9 11h1v2h-1z";

export const RAYS =
  "M3 7h3v2h-3zM10 7h3v2h-3zM7 3h2v3h-2zM7 10h2v3h-2zM5 6h1v1h-1zM5 9h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM10 6h1v1h-1zM10 9h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1z";

export const CORE = "M6 7h4v2h-4zM7 6h2v4h-2z";

/** The star's three tones; the same in both themes, as Paper draws it on both skies. */
export const STAR_TONES = { glow: "#7C9FE8", ray: "#BCD3FF", core: "#FFFFFF" } as const;

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

/** Every pixel a path of `M x y h w v h h-w z` rectangles covers. */
export const pixelsOf = (d: string): ReadonlyArray<Pixel> =>
  [...d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)/g)].flatMap(([, x, y, w, h]) =>
    Array.from({ length: Number(w) * Number(h) }, (_, i) => ({
      x: Number(x) + (i % Number(w)),
      y: Number(y) + Math.floor(i / Number(w)),
    }))
  );

export const GLOW_PIXELS = pixelsOf(GLOW);

export interface TwinkleLayer {
  readonly alpha: number;
  readonly d: string;
}

/**
 * The glow over `frames` dither frames side by side, each STAR_GRID wide: a glow pixel is lit
 * where the 16-cell Working dither lights its cell, at that cell's alpha.
 */
const twinkle = (frames: number): ReadonlyArray<TwinkleLayer> => {
  const glow = new Set(GLOW_PIXELS.map(({ x, y }) => `${x},${y}`));
  const side = STAR_GRID * DITHER_CELL;
  const paths = new Map<string, string>();

  for (let frame = 0; frame < frames; frame++) {
    for (const cell of ditherFrameAt({ width: side, height: side }, frame)) {
      const [x, y] = [cell.x / DITHER_CELL, cell.y / DITHER_CELL];

      if (!glow.has(`${x},${y}`)) continue;
      const alpha = cell.alpha.toFixed(2);

      paths.set(alpha, `${paths.get(alpha) ?? ""}M${x + frame * STAR_GRID} ${y}h1v1h-1z`);
    }
  }

  return [...paths].map(([alpha, d]) => ({ alpha: Number(alpha), d }));
};

/** Every twinkle frame in one strip, stepped by translating it. */
export const TWINKLE_STRIP = twinkle(DITHER_FRAMES);

/** The first frame alone: the twinkle under Reduce Motion. */
export const TWINKLE_STILL = twinkle(1);

export { GLOW };
