/**
 * The Working dither as SVG paths: @polaris/ui/dither's frames side by side in one strip, one path
 * per cell alpha (to 2 places, as the Desktop App's mask), so a glyph is a few dozen paths.
 */
import { DITHER_CELL, DITHER_FRAMES, ditherFrameAt } from "@polaris/ui/dither";

export interface DitherLayer {
  readonly alpha: number;
  readonly d: string;
}

export interface DitherArt {
  /** The whole strip: `size` × the frame count. */
  readonly width: number;
  readonly height: number;
  readonly layers: ReadonlyArray<DitherLayer>;
}

const build = (size: number, frames: number, intensity: number | undefined): DitherArt => {
  const paths = new Map<string, string>();

  for (let frame = 0; frame < frames; frame++) {
    for (const cell of ditherFrameAt({ width: size, height: size }, frame, intensity)) {
      const alpha = cell.alpha.toFixed(2);
      const square = `M${cell.x + frame * size} ${cell.y}h${DITHER_CELL}v${DITHER_CELL}h-${DITHER_CELL}z`;

      paths.set(alpha, (paths.get(alpha) ?? "") + square);
    }
  }

  return {
    width: size * frames,
    height: size,
    layers: [...paths].map(([alpha, d]) => ({ alpha: Number(alpha), d })),
  };
};

const cache = new Map<string, DitherArt>();

const cached = (size: number, frames: number, intensity: number | undefined): DitherArt => {
  const key = `${size}:${frames}:${intensity ?? ""}`;
  const hit = cache.get(key);

  if (hit !== undefined) return hit;
  const art = build(size, frames, intensity);

  cache.set(key, art);

  return art;
};

/** Every frame of a square glyph `size` points wide, stepped by translating it. */
export const ditherStrip = (size: number, intensity?: number): DitherArt =>
  cached(size, DITHER_FRAMES, intensity);

/** The first frame alone: Starting's pattern and the Reduce Motion stand-in. */
export const ditherStill = (size: number, intensity?: number): DitherArt =>
  cached(size, 1, intensity);

export interface DitherSteps {
  readonly inputRange: ReadonlyArray<number>;
  readonly outputRange: ReadonlyArray<number>;
}

/**
 * The strip's translate over a 0–1 clock, as CSS `steps(12)`: flat for each frame, jumping a
 * frame at zero width. The native driver interpolates its clock between 60 Hz samples, so the
 * steps live here rather than in an easing, or ProMotion would show half-steps.
 */
export const ditherSteps = (size: number): DitherSteps => {
  const inputRange: number[] = [];
  const outputRange: number[] = [];

  for (let frame = 0; frame < DITHER_FRAMES; frame++) {
    inputRange.push(frame / DITHER_FRAMES, (frame + 1) / DITHER_FRAMES);
    outputRange.push(0 - frame * size, 0 - frame * size);
  }

  return { inputRange, outputRange };
};
