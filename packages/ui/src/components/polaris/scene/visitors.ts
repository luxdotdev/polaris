/**
 * The scene's rare visitors: a meteor across the night sky, a V of birds across the dawn sky.
 * Each picks a path through clear sky (never over the hills, text or the setup card) when it is
 * due, and skips its turn when no path is clear.
 */
import { type Paint, inSky } from "./actors";
import { between, type Random } from "./colour";
import type { Point, Rect, SceneMap } from "./map";

/** A meteor's head moves one pixel per this many ms. */
export const METEOR_STEP_MS = 18;

/** The longest streak; each meteor is 40–70 pixels. */
export const METEOR_LENGTH = 70;

/** Tens of seconds apart: the first comes sooner so a short visit may see one. */
export const METEOR_GAP_MS: readonly [number, number] = [25_000, 70_000];

const METEOR_FIRST_MS: readonly [number, number] = [8_000, 25_000];

/** The tail is this many pixels behind the head; it cools from white into the sky. */
export const TAIL_LENGTH = 8;

/** Which meteor colour a pixel `age` steps behind the head takes: head, then three tail tones. */
export const tailColour = (age: number) => (age === 0 ? 0 : age <= 2 ? 1 : age <= 5 ? 2 : 3);

/** A slope of one in two: x moves every step, y every other step, in whole pixels. */
export const meteorPath = (start: Point, dir: 1 | -1, length = METEOR_LENGTH): Point[] =>
  Array.from({ length }, (_, i) => [start[0] + dir * i, start[1] + Math.floor(i / 2)] as const);

const candidate = (map: SceneMap, random: Random) => {
  const dir: 1 | -1 = random() < 0.5 ? 1 : -1;
  const x = Math.floor(between(random, 20, map.width - 20));
  const y = Math.floor(between(random, 6, map.height * 0.3));

  return meteorPath([x, y], dir, Math.floor(between(random, 40, METEOR_LENGTH + 1)));
};

export class Meteor {
  private path: Point[] | null = null;
  private start = 0;
  private next: number;

  constructor(
    private readonly map: SceneMap,
    private readonly random: Random
  ) {
    this.next = between(random, ...METEOR_FIRST_MS);
  }

  get flying() {
    return this.path !== null;
  }

  /** Makes it due now (screenshots and the hitches script). */
  summon(t: number) {
    this.next = t;
  }

  get due() {
    return this.next;
  }

  advance(t: number, keepOut: readonly Rect[]) {
    if (this.path !== null && t >= this.start + (this.path.length + TAIL_LENGTH) * METEOR_STEP_MS)
      this.path = null;

    if (this.path !== null || t < this.next || this.map.meteor.length === 0) return;
    this.next = t + between(this.random, ...METEOR_GAP_MS);

    for (let tries = 0; tries < 32; tries++) {
      const path = candidate(this.map, this.random);

      if (path.every((p) => inSky(this.map, keepOut, p))) {
        this.path = path;
        this.start = t;

        return;
      }
    }
  }

  paint(t: number, paint: Paint) {
    const colours = this.map.meteor;

    if (this.path === null) return;
    const head = Math.floor((t - this.start) / METEOR_STEP_MS);

    for (
      let step = Math.max(0, head - TAIL_LENGTH);
      step <= Math.min(head, this.path.length - 1);
      step++
    ) {
      const p = this.path[step];
      const color = colours[tailColour(head - step)];

      if (p !== undefined && color !== undefined) paint({ x: p[0], y: p[1], color, alpha: 1 });
    }
  }
}

/** Wings up, level, down: a distant bird is 3×2 pixels. */
export const BIRD_FRAMES: readonly (readonly string[])[] = [
  ["X.X", ".X."],
  ["XXX", "..."],
  [".X.", "X.X"],
];

export const BIRD_FRAME_MS = 170;

/** Slowly: a pixel every 110ms, about 45s across the scene. */
export const BIRD_PX_MS = 110;

export const FLOCK_GAP_MS: readonly [number, number] = [40_000, 90_000];

const FLOCK_FIRST_MS: readonly [number, number] = [12_000, 35_000];

/** A V behind the leader, which flies at the point: (back, up/down) per follower. */
export const flockOffsets = (size: 3 | 5): Point[] => {
  const v: Point[] = [[0, 0]];

  for (let k = 1; k <= (size - 1) / 2; k++) v.push([-5 * k, -2 * k], [-5 * k, 2 * k]);

  return v;
};

interface Flight {
  readonly start: number;
  readonly dir: 1 | -1;
  readonly y: number;
  readonly birds: readonly Point[];
}

export class Flock {
  private flight: Flight | null = null;
  private next: number;

  constructor(
    private readonly map: SceneMap,
    private readonly random: Random
  ) {
    this.next = between(random, ...FLOCK_FIRST_MS);
  }

  get flying() {
    return this.flight !== null;
  }

  summon(t: number) {
    this.next = t;
  }

  /** The leader's x at `t`: from 30px off one side to 30px off the other. */
  private leaderX(t: number, flight: Flight) {
    const travelled = Math.floor((t - flight.start) / BIRD_PX_MS);

    return flight.dir > 0 ? -30 + travelled : this.map.width + 30 - travelled;
  }

  advance(t: number, keepOut: readonly Rect[]) {
    if (
      this.flight !== null &&
      Math.abs(this.leaderX(t, this.flight) - this.map.width / 2) > this.map.width / 2 + 60
    )
      this.flight = null;

    if (this.flight !== null || t < this.next || this.map.bird === null) return;
    this.next = t + between(this.random, ...FLOCK_GAP_MS);
    const sky = Math.min(...this.map.skyline);

    for (let tries = 0; tries < 24; tries++) {
      const y = Math.floor(between(this.random, 12, sky - 14));
      const birds = flockOffsets(this.random() < 0.5 ? 3 : 5);
      // The whole band it crosses (the V spans 4px either side) must be clear of text and the card.
      const clear = keepOut.every((r) => y + 6 < r.y - 3 || y - 6 > r.y + r.h + 3);

      if (clear && y > 8) {
        this.flight = { start: t, dir: this.random() < 0.5 ? 1 : -1, y, birds };

        return;
      }
    }
  }

  paint(t: number, paint: Paint) {
    const flight = this.flight;
    const color = this.map.bird;

    if (flight === null || color === null) return;
    const lead = this.leaderX(t, flight);

    flight.birds.forEach(([back, up], i) => {
      const frame = BIRD_FRAMES[(Math.floor(t / BIRD_FRAME_MS) + i) % BIRD_FRAMES.length] ?? [];
      const x0 = lead + back * flight.dir - 1;
      const y0 = flight.y + up;

      frame.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++)
          if (row[dx] === "X") paint({ x: x0 + dx, y: y0 + dy, color, alpha: 1 });
      });
    });
  }
}
