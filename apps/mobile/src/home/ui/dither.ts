/**
 * The Working dither's cells: @polaris/ui's dither/frames.ts (a Bayer 4×4 threshold over a moving
 * diagonal wave), as plain cells React Native draws with Views. 12 frames, 83 ms each.
 */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export const DITHER_CELL = 2;

export const DITHER_FRAMES = 12;

export const DITHER_FRAME_MS = 83;

export interface LitCell {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

const cache = new Map<string, ReadonlyArray<LitCell>>();

/** One frame of a square glyph `size` points wide; frame 0 is the still (Reduce Motion). */
export const ditherFrame = (size: number, frame: number): ReadonlyArray<LitCell> => {
  const key = `${size}:${frame}`;
  const hit = cache.get(key);

  if (hit !== undefined) return hit;
  const phase = (frame / DITHER_FRAMES) * Math.PI * 2;
  const cells: LitCell[] = [];
  const count = Math.floor(size / DITHER_CELL);

  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      const v = 0.2 + 0.6 * 0.5 * (1 + Math.sin((x * 0.9 + y * 0.6) / 2.2 - phase));
      const threshold = ((BAYER4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16;

      if (threshold < v)
        cells.push({ x: x * DITHER_CELL, y: y * DITHER_CELL, alpha: Math.min(0.4 + 0.6 * v, 1) });
    }
  }

  cache.set(key, cells);

  return cells;
};
