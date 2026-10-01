/**
 * The scene's ambient life, each as a small state machine over time in ms: twinkling stars,
 * the cabin lamp breathing, smoke drifting, and the rare meteor (night) or flock (dawn). Each
 * paints scene pixels into a list; the layer draws them over the still scene.
 */
import { between, mix, type Random } from "./colour";
import type { CabinMap, Point, Rect, SceneMap } from "./map";

export interface Pixel {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly alpha: number;
}

export type Paint = (pixel: Pixel) => void;

const STAR_PALETTE = ["#E8EEFF", "#BCD3FF", "#8A96B8", "#4A5578"] as const;

/** At most this many stars twinkle at once. */
export const MAX_TWINKLES = 3;

interface Twinkle {
  readonly star: number;
  readonly start: number;
  readonly duration: number;
}

/** A star brightens a step or two, settles, dims toward the sky, and settles again. */
export const twinkleColor = (base: string, under: string, phase: number): string | null => {
  const at = STAR_PALETTE.findIndex((colour) => colour === base);
  const brighter = (n: number) => STAR_PALETTE[Math.max(0, at - n)] ?? base;
  const stages = [brighter(1), brighter(2), brighter(1), null, mix(base, under, 0.6), null];

  return stages[Math.min(stages.length - 1, Math.floor(phase * stages.length))] ?? null;
};

export class Twinkles {
  private active: Twinkle[] = [];
  private next = 0;

  constructor(
    private readonly map: SceneMap,
    private readonly random: Random
  ) {}

  advance(t: number) {
    this.active = this.active.filter((tw) => t < tw.start + tw.duration);

    if (this.map.stars.length === 0 || t < this.next) return;
    this.next = t + between(this.random, 1000, 2500);

    if (this.active.length >= MAX_TWINKLES) return;
    const star = Math.floor(this.random() * this.map.stars.length);

    if (this.active.some((tw) => tw.star === star)) return;
    this.active.push({ star, start: t, duration: between(this.random, 3000, 5000) });
  }

  get count() {
    return this.active.length;
  }

  paint(t: number, paint: Paint) {
    for (const tw of this.active) {
      const star = this.map.stars[tw.star];

      if (star === undefined) continue;
      const [x, y, base, under] = star;
      const color = twinkleColor(base, under, (t - tw.start) / tw.duration);

      if (color !== null) paint({ x, y, color, alpha: 1 });
    }
  }
}

/** Lamp light as four levels; level 2 is the scene's own colour (nothing drawn). */
export const LAMP_LEVELS = 4;

const RESTING_LEVEL = 2;

/**
 * The lamp's level at `t`: two slow waves (3.7s and 6.1s) so it breathes irregularly, plus a
 * brief one-level dip now and then. It moves at most one level per step: never a strobe.
 */
export const lampLevel = (t: number, dipping: boolean): number => {
  const wave =
    0.55 +
    0.28 * Math.sin((2 * Math.PI * t) / 3700) +
    0.17 * Math.sin((2 * Math.PI * t) / 6100 + 1.3);

  const level = Math.min(LAMP_LEVELS - 1, Math.max(0, Math.floor(wave * LAMP_LEVELS)));

  return dipping ? Math.max(0, level - 1) : level;
};

export class Lamp {
  private dipUntil = 0;
  private nextDip = 0;
  private readonly lamp: readonly string[];
  private readonly door: readonly string[];

  constructor(
    private readonly cabin: CabinMap,
    private readonly random: Random
  ) {
    const { lampColor: l, doorColor: d } = cabin;

    this.lamp = [mix(l, d, 0.5), mix(l, d, 0.25), l, mix(l, "#FFEACC", 0.4)];
    this.door = [mix(d, "#000000", 0.3), mix(d, "#000000", 0.15), d, mix(d, l, 0.35)];
    this.nextDip = between(random, 3000, 7000);
  }

  advance(t: number) {
    if (t < this.nextDip) return;
    this.dipUntil = t + between(this.random, 140, 260);
    this.nextDip = t + between(this.random, 4000, 9000);
  }

  level(t: number) {
    return lampLevel(t, t < this.dipUntil);
  }

  paint(t: number, paint: Paint) {
    const level = this.level(t);

    if (level === RESTING_LEVEL) return;
    const lamp = this.lamp[level] ?? this.cabin.lampColor;
    const door = this.door[level] ?? this.cabin.doorColor;

    for (const [x, y] of this.cabin.lamp) paint({ x, y, color: lamp, alpha: 1 });

    for (const [x, y] of this.cabin.door) paint({ x, y, color: door, alpha: 1 });
  }
}

interface Puff {
  readonly born: number;
  readonly x: number;
  readonly y: number;
  readonly drift: number;
}

/** A puff rises a pixel a second and is gone after six. */
export const PUFF_RISE_MS = 1000;

const PUFF_ALPHA = [0.55, 0.45, 0.35, 0.25, 0.15, 0.08] as const;

export class Smoke {
  private puffs: Puff[] = [];
  private next = 0;
  private readonly top: Point;

  constructor(
    private readonly cabin: CabinMap,
    private readonly random: Random
  ) {
    this.top = cabin.smoke.reduce((a, b) => (b[1] < a[1] ? b : a), cabin.chimney);
  }

  advance(t: number) {
    this.puffs = this.puffs.filter((p) => t < p.born + PUFF_RISE_MS * PUFF_ALPHA.length);

    if (t < this.next) return;
    this.next = t + between(this.random, 2500, 4500);

    if (this.puffs.length >= 3) return;
    this.puffs.push({
      born: t,
      x: this.top[0],
      y: this.top[1] - 1,
      drift: 2 + Math.floor(this.random() * 2),
    });
  }

  paint(t: number, paint: Paint) {
    for (const puff of this.puffs) {
      const rise = Math.floor((t - puff.born) / PUFF_RISE_MS);
      const alpha = PUFF_ALPHA[rise];

      if (alpha === undefined) continue;
      paint({
        x: puff.x + Math.floor(rise / puff.drift),
        y: puff.y - rise,
        color: this.cabin.smokeColor,
        alpha,
      });
    }
  }
}

/** Whether a point is inside any rect grown by `margin`. */
export const blocked = (x: number, y: number, rects: readonly Rect[], margin: number) =>
  rects.some(
    (r) =>
      x >= r.x - margin && x < r.x + r.w + margin && y >= r.y - margin && y < r.y + r.h + margin
  );

/** Whether a point is clear sky: in the scene, well above the hills and away from the rects. */
export const inSky = (map: SceneMap, keepOut: readonly Rect[], [x, y]: Point, margin = 6) => {
  const line = map.skyline[x];

  return line !== undefined && y >= 2 && y < line - margin && !blocked(x, y, keepOut, margin);
};
