/**
 * The Working dither: 2px cells lit by a Bayer 4x4 threshold over a moving diagonal wave.
 * A port of design/scripts/gen_dither.py's dither(), baked into a horizontal sprite strip.
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

function rects(cells: readonly LitCell[], offsetX: number): string {
  return cells
    .map(
      (cell) =>
        `<rect x="${cell.x + offsetX}" y="${cell.y}" width="${DITHER_CELL}" height="${DITHER_CELL}" fill-opacity="${cell.alpha.toFixed(2)}"/>`
    )
    .join("");
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;
}

function dataUrl(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

export interface DitherSize {
  readonly width: number;
  readonly height: number;
}

function fieldFor(size: DitherSize, phase: number): DitherField {
  const band = size.height < size.width / 4;

  return band
    ? { ...size, base: 0.1, amp: 0.75, k: 3.5, phase }
    : { ...size, base: 0.2, amp: 0.6, k: 2.2, phase };
}

const cache = new Map<string, string>();

function cached(key: string, build: () => string): string {
  const hit = cache.get(key);

  if (hit !== undefined) return hit;

  const value = build();

  cache.set(key, value);

  return value;
}

/** A CSS mask of every frame side by side; stepped by translating it (DESIGN.md, Dither). */
export function ditherStripMask(size: DitherSize): string {
  return cached(`strip:${size.width}x${size.height}`, () => {
    let body = "";

    for (let frame = 0; frame < DITHER_FRAMES; frame++) {
      const phase = (frame / DITHER_FRAMES) * Math.PI * 2;

      body += rects(ditherFrame(fieldFor(size, phase)), frame * size.width);
    }

    return dataUrl(svg(size.width * DITHER_FRAMES, size.height, body));
  });
}

/** One still frame: the Starting pattern and the Reduce Motion stand-in. */
export function ditherStillMask(size: DitherSize): string {
  return cached(`still:${size.width}x${size.height}`, () =>
    dataUrl(svg(size.width, size.height, rects(ditherFrame(fieldFor(size, 0)), 0)))
  );
}
