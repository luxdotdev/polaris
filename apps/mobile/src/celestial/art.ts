/**
 * A celestial as SVG paths: @polaris/ui/celestial's cells, one path per tone with each row's runs
 * merged, the Working frames side by side in one strip as the Desktop App draws it.
 */
import type { CelestialBody } from "@polaris/protocol";
import {
  CELESTIAL_FRAMES,
  CELESTIAL_GRID,
  type Cell,
  celestialCells,
  type Tone,
} from "@polaris/ui/celestial";

export interface CelestialLayer {
  readonly tone: Tone;
  readonly d: string;
}

export interface CelestialArt {
  /** In grid cells: CELESTIAL_GRID × the frame count. */
  readonly width: number;
  readonly layers: ReadonlyArray<CelestialLayer>;
}

const TONES: readonly Tone[] = ["light", "hue", "shade", "glint", "laser"];

const rect = (x: number, y: number, width: number) => `M${x} ${y}h${width}v1h${-width}z`;

/** Each row's same-tone neighbours as one rectangle: a few dozen commands instead of ~150. */
const runs = (cells: ReadonlyArray<Cell>): Map<Tone, string> => {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  const d = new Map<Tone, string>();

  const close = (run: Cell, width: number) =>
    d.set(run.tone, (d.get(run.tone) ?? "") + rect(run.x, run.y, width));

  let run: Cell | null = null;
  let width = 0;

  for (const cell of sorted) {
    if (run !== null && cell.y === run.y && cell.tone === run.tone && cell.x === run.x + width) {
      width += 1;

      continue;
    }

    if (run !== null) close(run, width);

    run = cell;
    width = 1;
  }

  if (run !== null) close(run, width);

  return d;
};

const build = (body: CelestialBody, frames: ReadonlyArray<number | null>): CelestialArt => {
  const cells = frames.flatMap((frame, i) =>
    celestialCells(body, frame).map((cell) => ({ ...cell, x: cell.x + i * CELESTIAL_GRID }))
  );

  const d = runs(cells);

  return {
    width: frames.length * CELESTIAL_GRID,
    layers: TONES.flatMap((tone) => {
      const path = d.get(tone);

      return path === undefined ? [] : [{ tone, d: path }];
    }),
  };
};

const cache = new Map<string, CelestialArt>();

const cached = (key: string, make: () => CelestialArt): CelestialArt => {
  const hit = cache.get(key);

  if (hit !== undefined) return hit;
  const art = make();

  cache.set(key, art);

  return art;
};

/** The body at rest (frame null): not working, or Reduce Motion. */
export const celestialStill = (body: CelestialBody): CelestialArt =>
  cached(`${body}:still`, () => build(body, [null]));

/** Every Working frame, stepped by translating the strip a frame at a time. */
export const celestialStrip = (body: CelestialBody): CelestialArt =>
  cached(`${body}:strip`, () =>
    build(
      body,
      Array.from({ length: CELESTIAL_FRAMES }, (_, frame) => frame)
    )
  );

export interface CelestialSteps {
  readonly inputRange: ReadonlyArray<number>;
  readonly outputRange: ReadonlyArray<number>;
}

/**
 * The strip's translate over a 0–1 clock, as CSS `steps(8)`: flat for each frame, jumping at zero
 * width, so the native driver's interpolated samples never land between frames.
 */
export const celestialSteps = (size: number): CelestialSteps => {
  const inputRange: number[] = [];
  const outputRange: number[] = [];

  for (let frame = 0; frame < CELESTIAL_FRAMES; frame++) {
    inputRange.push(frame / CELESTIAL_FRAMES, (frame + 1) / CELESTIAL_FRAMES);
    outputRange.push(0 - frame * size, 0 - frame * size);
  }

  return { inputRange, outputRange };
};
