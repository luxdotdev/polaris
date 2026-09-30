/**
 * The Working strip's dither field, measured from the reference: 1px dots on a 2px grid in the
 * hue, densest at the top-left corner; a lingering hue trail behind the pointer; sparse
 * near-white dots on a staggered 8×4px lattice around it; and a bloom when the status changes.
 */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** Dots are 1px on this pitch, in CSS px. */
export const DOT_PITCH = 2;

/** A hue dot's alpha at full value (dark theme); light passes its own. */
export const HUE_ALPHA = 0.46;

/** The tint between dots at full value (dark theme). */
export const WASH_ALPHA = 0.14;

const REST = { rx: 150, ry: 46, gain: 0.62 } as const;

const SPARSE = { pitchX: 8, pitchY: 4, radius: 22, alpha: 0.92 } as const;

const TRAIL = { sx: 22, sy: 14, decayMs: 420, strength: 0.7 } as const;

const BLOOM = { riseMs: 400, settleMs: 900 } as const;

export const BLOOM_MS = BLOOM.riseMs + BLOOM.settleMs;

export interface Bloom {
  readonly gain: number;
  readonly spread: number;
}

export const RESTING: Bloom = { gain: REST.gain, spread: 1 };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The corner's gain and reach `ms` after a status change: it floods, then settles to rest. */
export function bloomAt(ms: number): Bloom {
  if (ms >= BLOOM_MS) return RESTING;

  if (ms < BLOOM.riseMs) {
    const t = easeOut(ms / BLOOM.riseMs);

    return { gain: mix(0, 1, t), spread: mix(0.5, 1.3, t) };
  }

  const t = easeOut((ms - BLOOM.riseMs) / BLOOM.settleMs);

  return { gain: mix(1, REST.gain, t), spread: mix(1.3, 1, t) };
}

/** The corner texture's value (0–1) at a point, before the bloom's gain. */
export function cornerValue(x: number, y: number, spread: number): number {
  const r = Math.hypot(x / (REST.rx * spread), y / (REST.ry * spread));

  return r >= 1 ? 0 : 1 - r;
}

/** The lingering hue trail, one value per dot: stamped at the pointer, decaying everywhere. */
export class Trail {
  readonly values: Float32Array;

  constructor(
    readonly columns: number,
    readonly rows: number
  ) {
    this.values = new Float32Array(columns * rows);
    this.previous = new Float32Array(columns * rows);
  }

  private readonly previous: Float32Array;

  /** Decays by `dt` ms, then stamps the pointer; returns whether any dot visibly changed. */
  update(dt: number, x: number, y: number, strength: number): boolean {
    this.previous.set(this.values);
    this.decay(dt);
    this.stamp(x, y, strength);

    for (let at = 0; at < this.values.length; at++)
      if (Math.abs((this.values[at] ?? 0) - (this.previous[at] ?? 0)) > 1e-6) return true;

    return false;
  }

  decay(dt: number): void {
    const keep = Math.exp(-dt / TRAIL.decayMs);

    for (let at = 0; at < this.values.length; at++) {
      const v = (this.values[at] ?? 0) * keep;

      this.values[at] = v < 0.01 ? 0 : v;
    }
  }

  /** Raises the trail to a soft ellipse of `strength` around (x, y), in CSS px. */
  stamp(x: number, y: number, strength: number): void {
    if (strength <= 0) return;
    const i0 = Math.max(0, Math.floor((x - 3 * TRAIL.sx) / DOT_PITCH));
    const i1 = Math.min(this.columns - 1, Math.ceil((x + 3 * TRAIL.sx) / DOT_PITCH));
    const j0 = Math.max(0, Math.floor((y - 3 * TRAIL.sy) / DOT_PITCH));
    const j1 = Math.min(this.rows - 1, Math.ceil((y + 3 * TRAIL.sy) / DOT_PITCH));

    for (let j = j0; j <= j1; j++) {
      const dy = (j * DOT_PITCH - y) / TRAIL.sy;

      for (let i = i0; i <= i1; i++) {
        const dx = (i * DOT_PITCH - x) / TRAIL.sx;
        const v = TRAIL.strength * strength * Math.exp(-(dx * dx + dy * dy) / 2);
        const at = j * this.columns + i;

        if (v > (this.values[at] ?? 0)) this.values[at] = v;
      }
    }
  }
}

/** Whether a dot sits on the sparse lattice: rows 4px apart, every other row offset by 4px. */
export function onLattice(x: number, y: number): boolean {
  if (y % SPARSE.pitchY !== 0) return false;
  const offset = (y / SPARSE.pitchY) % 2 === 0 ? 0 : SPARSE.pitchX / 2;

  return (x - offset) % SPARSE.pitchX === 0;
}

/** A sparse dot's alpha around the pointer, dimming toward the patch's edge. */
export function sparseAlpha(x: number, y: number, frame: FieldFrame): number {
  if (frame.presence === 0 || !onLattice(x, y)) return 0;
  const d = Math.hypot(x - frame.pointer.x, y - frame.pointer.y) / SPARSE.radius;

  return d >= 1 ? 0 : frame.presence * SPARSE.alpha * (1 - 0.45 * d * d);
}

export interface FieldFrame {
  readonly bloom: Bloom;
  readonly trail: Trail | null;
  /** Where the sparse patch sits, in CSS px from the field's top-left. */
  readonly pointer: { readonly x: number; readonly y: number };
  /** 0 with no pointer, 1 fully hovered. */
  readonly presence: number;
}

export const STILL: FieldFrame = {
  bloom: RESTING,
  trail: null,
  pointer: { x: 0, y: 0 },
  presence: 0,
};

/** A hue dot's value (0–1) at dot (i, j): the corner under the bloom, plus the trail. */
export function hueValue(i: number, j: number, frame: FieldFrame): number {
  const corner = cornerValue(i * DOT_PITCH, j * DOT_PITCH, frame.bloom.spread) * frame.bloom.gain;
  const trail = frame.trail?.values[j * frame.trail.columns + i] ?? 0;

  return Math.min(1, corner + trail);
}

/** Whether the Bayer threshold keeps dot (i, j) at value `v`, so the fringe thins out. */
export function kept(i: number, j: number, v: number): boolean {
  return ((BAYER4[(j % 4) * 4 + (i % 4)] ?? 0) + 0.5) / 16 < v * 1.5;
}

/** A hue dot's alpha, or 0 where the Bayer threshold drops it. */
export function hueAlpha(i: number, j: number, frame: FieldFrame, alpha = HUE_ALPHA): number {
  const v = hueValue(i, j, frame);

  return kept(i, j, v) ? alpha * v : 0;
}

export type Rgb = readonly [number, number, number];

/** One RGBA pixel, packed for a little-endian Uint32Array over ImageData. */
export function packPixel(rgb: Rgb, alpha: number): number {
  return ((Math.round(alpha * 255) << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0]) >>> 0;
}

export interface FieldColors {
  readonly hue: Rgb;
  readonly sparse: Rgb;
  readonly hueAlpha: number;
  /** The faint tint between dots at full value. */
  readonly washAlpha: number;
}

export interface FieldPixels {
  readonly pixels: Uint32Array;
  readonly width: number;
  readonly height: number;
}

/** The dot at (x, y) and the three wash pixels of its 2×2 cell. */
function paintCell(target: FieldPixels, x: number, y: number, dot: number, wash: number) {
  const { pixels, width, height } = target;
  const at = y * width + x;

  pixels[at] = dot;

  if (wash === 0) return;

  if (x + 1 < width) pixels[at + 1] = wash;

  if (y + 1 >= height) return;
  pixels[at + width] = wash;

  if (x + 1 < width) pixels[at + width + 1] = wash;
}

/** Paints a frame into `target`, one canvas pixel per CSS px: a dot per 2px cell over a wash. */
export function paintFrame(target: FieldPixels, colors: FieldColors, frame: FieldFrame): void {
  target.pixels.fill(0);

  for (let y = 0; y < target.height; y += DOT_PITCH) {
    for (let x = 0; x < target.width; x += DOT_PITCH) {
      const i = x / DOT_PITCH;
      const j = y / DOT_PITCH;
      const v = hueValue(i, j, frame);
      const sparse = sparseAlpha(x, y, frame);

      const wash =
        colors.washAlpha * v * 255 >= 0.5 ? packPixel(colors.hue, colors.washAlpha * v) : 0;

      let dot = wash;

      if (sparse > 0) dot = packPixel(colors.sparse, sparse);
      else if (kept(i, j, v)) dot = packPixel(colors.hue, colors.hueAlpha * v);

      if (dot !== 0 || wash !== 0) paintCell(target, x, y, dot, wash);
    }
  }
}
