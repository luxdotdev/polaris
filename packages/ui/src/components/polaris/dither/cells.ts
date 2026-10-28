/**
 * @polaris/ui/dither: the Working dither's cells, 2px squares lit by a Bayer 4x4 threshold over a
 * moving diagonal wave (a port of design/scripts/gen_dither.py's dither()). Plain data with no DOM,
 * so the Desktop App's sprite strip and the Mobile App's draw the same frames.
 */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export const DITHER_CELL = 2;

/** 12 frames over one wave period: 83ms per frame at the 1s loop. */
export const DITHER_FRAMES = 12;

export const DITHER_FRAME_MS = 83;

/** Fades in on entering Working and out on leaving it (DESIGN.md, Dither). */
export const DITHER_EXIT_MS = 200;

export interface DitherField {
  readonly width: number;
  readonly height: number;
  readonly base: number;
  readonly amp: number;
  readonly k: number;
  readonly phase: number;
}

export interface LitCell {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

export function ditherFrame(field: DitherField): LitCell[] {
  const cells: LitCell[] = [];
  const columns = Math.floor(field.width / DITHER_CELL);
  const rows = Math.floor(field.height / DITHER_CELL);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const wave = Math.sin((x * 0.9 + y * 0.6) / field.k - field.phase);
      const v = field.base + field.amp * 0.5 * (1 + wave);
      const threshold = ((BAYER4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16;

      if (threshold < v) {
        cells.push({ x: x * DITHER_CELL, y: y * DITHER_CELL, alpha: Math.min(0.4 + 0.6 * v, 1) });
      }
    }
  }

  return cells;
}

export interface DitherSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The field's lit share. Without `intensity` it is the Working dither's own (a band or a glyph);
 * with one (0–1, the effort bar) it runs from sparse and faint to dense and bright.
 */
export function ditherField(size: DitherSize, phase: number, intensity?: number): DitherField {
  if (intensity !== undefined)
    return { ...size, base: 0.04 + 0.46 * intensity, amp: 0.18 + 0.42 * intensity, k: 2.6, phase };

  const band = size.height < size.width / 4;

  return band
    ? { ...size, base: 0.1, amp: 0.75, k: 3.5, phase }
    : { ...size, base: 0.2, amp: 0.6, k: 2.2, phase };
}

/** Frame `frame` of the strip's 12; frame 0 is the still pattern (Starting, Reduce Motion). */
export function ditherFrameAt(size: DitherSize, frame: number, intensity?: number): LitCell[] {
  return ditherFrame(ditherField(size, (frame / DITHER_FRAMES) * Math.PI * 2, intensity));
}
