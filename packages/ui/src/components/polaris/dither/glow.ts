/**
 * The Working strip's dither field: a still halo from the top-left corner that brightens
 * around the pointer and ripples where it enters or presses, thresholded by Bayer 4x4 on
 * the 2px cell grid. Pure, so it paints into any RGBA buffer.
 */
import { DITHER_CELL } from "./frames";

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** A lit cell's alpha at full value: the halo reads at ~35% (DESIGN.md, Dither halo). */
export const FIELD_ALPHA = 0.42;

const HALO = { x: 40, y: 4, rx: 170, ry: 64, strength: 0.6 } as const;

const GLOW = { sigma: 24, strength: 0.7 } as const;

const RIPPLE = { speed: 0.22, width: 5, strength: 0.55, life: 520 } as const;

export interface Ripple {
  readonly x: number;
  readonly y: number;
  /** Milliseconds since it started. */
  readonly age: number;
}

export interface FieldState {
  /** Where the glow sits, in px from the field's top-left; may lie outside it. */
  readonly pointer: { readonly x: number; readonly y: number };
  /** 0 with no pointer, 1 fully hovered. */
  readonly presence: number;
  readonly ripples: readonly Ripple[];
}

export const STILL: FieldState = { pointer: { x: 0, y: 0 }, presence: 0, ripples: [] };

export const RIPPLE_LIFE_MS = RIPPLE.life;

function halo(x: number, y: number): number {
  const d = Math.hypot((x - HALO.x) / HALO.rx, (y - HALO.y) / HALO.ry);

  return d >= 1 ? 0 : HALO.strength * (1 - d) ** 1.5;
}

function glow(x: number, y: number, state: FieldState): number {
  if (state.presence === 0) return 0;
  const d2 = (x - state.pointer.x) ** 2 + (y - state.pointer.y) ** 2;

  return state.presence * GLOW.strength * Math.exp(-d2 / (2 * GLOW.sigma ** 2));
}

function ripple(x: number, y: number, r: Ripple): number {
  const t = r.age / RIPPLE.life;

  if (t >= 1) return 0;
  const ring = Math.hypot(x - r.x, y - r.y) - r.age * RIPPLE.speed;

  return RIPPLE.strength * (1 - t) * Math.exp(-(ring ** 2) / (2 * RIPPLE.width ** 2));
}

/** Over its last 14px the field thins out, so it has no hard bottom edge. */
const EDGE_FADE = 14;

/** The field's value (0–1) at a point, before thresholding; `height` fades its bottom edge. */
export function fieldValue(x: number, y: number, state: FieldState, height = Infinity): number {
  let v = halo(x, y) + glow(x, y, state);

  for (const r of state.ripples) v += ripple(x, y, r);

  return Math.min(v, 1) * Math.min(1, Math.max(0, (height - y) / EDGE_FADE));
}

/** A lit cell's alpha (0–1), or 0 when the Bayer threshold leaves it dark. */
export function cellAlpha(column: number, row: number, state: FieldState, rows?: number): number {
  const x = column * DITHER_CELL + DITHER_CELL / 2;
  const y = row * DITHER_CELL + DITHER_CELL / 2;
  const v = fieldValue(x, y, state, rows === undefined ? Infinity : rows * DITHER_CELL);
  const threshold = ((BAYER4[(row % 4) * 4 + (column % 4)] ?? 0) + 0.5) / 16;

  return threshold < v ? FIELD_ALPHA * (0.4 + 0.6 * v) : 0;
}

export interface FieldBuffer {
  readonly data: Uint8ClampedArray;
  readonly columns: number;
  readonly rows: number;
}

/** Paints one cell per pixel of `buffer` in `rgb`; the canvas scales it up unsmoothed. */
export function paintField(
  buffer: FieldBuffer,
  rgb: readonly [number, number, number],
  state: FieldState
): void {
  const { data, columns, rows } = buffer;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = (row * columns + column) * 4;

      data[at] = rgb[0];
      data[at + 1] = rgb[1];
      data[at + 2] = rgb[2];
      data[at + 3] = Math.round(cellAlpha(column, row, state, rows) * 255);
    }
  }
}
