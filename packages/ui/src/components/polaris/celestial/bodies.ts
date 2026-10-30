/**
 * @polaris/ui/celestial: the Celestials' pixels (DESIGN.md, Celestials) on a 16 grid. Plain data
 * with no DOM, so the Desktop App's SVG and a later native renderer draw the same cells.
 */
import {
  CELESTIAL_MOONS,
  CELESTIAL_PLANETS,
  CELESTIAL_STARS,
  type CelestialBody,
} from "@polaris/protocol";

export const CELESTIAL_GRID = 16;

/** Working loops these frames at the dither's 12 fps. */
export const CELESTIAL_FRAMES = 8;

export const CELESTIAL_FRAME_MS = 83;

/**
 * Light, the hue itself, shade, the brief glint a Working ring or star carries, and the Death
 * Star's laser, the one tone that is never the hue's.
 */
export type Tone = "light" | "hue" | "shade" | "glint" | "laser";

/** The superlaser's green, the same on every theme and Harness. */
export const CELESTIAL_LASER = "#5cf59a";

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly tone: Tone;
}

interface Ring {
  readonly rx: number;
  readonly ry: number;
  /** Radians, clockwise. */
  readonly tilt: number;
}

interface Planet {
  readonly kind: "planet";
  readonly radius: number;
  /** Surface markings, periodic in x over CELESTIAL_FRAMES columns so their drift loops. */
  readonly marks?: (x: number, y: number) => boolean;
  readonly rings?: readonly Ring[];
  /** A crescent: the shadow's centre, offset from the body's. */
  readonly shadow?: { readonly dx: number; readonly dy: number };
  /** A fixed crater with a light focus; Working fires the superlaser from it, up and to the left. */
  readonly dish?: { readonly x: number; readonly y: number; readonly r: number };
}

interface Star {
  readonly kind: "star";
  readonly core: number;
  readonly long: number;
  readonly short: number;
  /** Long rays on the axes (a cross) or the diagonals. */
  readonly diagonal: boolean;
}

type Form = Planet | Star;

const CENTRE = (CELESTIAL_GRID - 1) / 2;

const mod = (n: number, m: number) => ((n % m) + m) % m;

const band =
  (rows: readonly number[], gaps: readonly number[] = []) =>
  (x: number, y: number) =>
    rows.includes(y) && !gaps.includes(mod(x, CELESTIAL_FRAMES));

const spots = (at: ReadonlyArray<readonly [number, number]>) => (x: number, y: number) =>
  at.some(([sx, sy]) => sx === mod(x, CELESTIAL_FRAMES) && sy === y);

const either =
  (...marks: ReadonlyArray<(x: number, y: number) => boolean>) =>
  (x: number, y: number) =>
    marks.some((mark) => mark(x, y));

const FORMS = new Map<CelestialBody, Form>(
  Object.entries({
    ringed: {
      kind: "planet",
      radius: 4.6,
      rings: [{ rx: 7.6, ry: 2.4, tilt: 0 }],
      marks: band([7], [2, 3]),
    },
    banded: { kind: "planet", radius: 6.2, marks: band([5, 9, 10], [1, 5]) },
    cratered: {
      kind: "planet",
      radius: 6,
      marks: spots([
        [2, 5],
        [6, 9],
        [3, 11],
        [5, 4],
      ]),
    },
    crescent: {
      kind: "planet",
      radius: 6.2,
      shadow: { dx: 4, dy: -3 },
      marks: spots([
        [1, 9],
        [3, 11],
      ]),
    },
    storm: {
      kind: "planet",
      radius: 6.2,
      marks: either(
        band([4], [0, 4]),
        spots([
          [5, 9],
          [6, 9],
          [6, 10],
          [7, 10],
        ])
      ),
    },
    polar: { kind: "planet", radius: 6, marks: band([7, 8], [2, 3, 6]) },
    "tilted-ring": {
      kind: "planet",
      radius: 4.4,
      rings: [{ rx: 7.4, ry: 2.2, tilt: -0.45 }],
      marks: spots([
        [1, 8],
        [5, 6],
      ]),
    },
    striped: { kind: "planet", radius: 6.2, marks: band([4, 6, 8, 10], [0, 3, 6]) },
    spotted: {
      kind: "planet",
      radius: 5.6,
      marks: spots([
        [1, 5],
        [4, 7],
        [6, 10],
        [2, 10],
        [5, 4],
      ]),
    },
    "twin-ring": {
      kind: "planet",
      radius: 4,
      rings: [{ rx: 7.6, ry: 2.6, tilt: 0.45 }],
      marks: band([7, 8], [0, 1, 4, 5]),
    },
    giant: { kind: "planet", radius: 7.4, marks: band([3, 6, 7, 11], [2, 6]) },
    dwarf: {
      kind: "planet",
      radius: 3.6,
      marks: spots([
        [2, 7],
        [5, 9],
      ]),
    },
    "star-cross": { kind: "star", core: 1.6, long: 7, short: 0, diagonal: false },
    "star-eight": { kind: "star", core: 1.6, long: 7, short: 4, diagonal: false },
    "star-spark": { kind: "star", core: 1.8, long: 6, short: 3, diagonal: true },
    "moon-full": {
      kind: "planet",
      radius: 3.4,
      marks: spots([
        [1, 7],
        [4, 9],
      ]),
    },
    "moon-crescent": {
      kind: "planet",
      radius: 3.6,
      shadow: { dx: 2, dy: -1 },
      marks: spots([
        [1, 8],
        [6, 9],
      ]),
    },
    "moon-cratered": {
      kind: "planet",
      radius: 3.4,
      marks: spots([
        [2, 6],
        [5, 8],
        [3, 9],
      ]),
    },
    "death-star": {
      kind: "planet",
      radius: 6.2,
      dish: { x: 5, y: 5, r: 2.3 },
      marks: band([8], [3]),
    },
  } satisfies Record<string, Form>)
);

/** The flat grey the Death Star wears in place of its Harness's hue. */
export const DEATH_STAR_GREY = "#8c8f95";

/** A hue a body wears whatever its Harness: only the Death Star has one. */
export const bodyHue = (body: CelestialBody): string | null =>
  body === "death-star" ? DEATH_STAR_GREY : null;

/** Whether a body is drawn here; an unknown one (from a newer Daemon) is drawn as the first planet. */
export const isKnownCelestial = (body: CelestialBody): boolean => FORMS.has(body);

const formOf = (body: CelestialBody): Form =>
  FORMS.get(body) ?? FORMS.get(CELESTIAL_PLANETS[0]) ?? { kind: "planet", radius: 6 };

const inDisc = (x: number, y: number, r: number) =>
  (x - CENTRE) ** 2 + (y - CENTRE) ** 2 <= r * r + r * 0.6;

/** Lit from the top left: light on that rim, shade on the far one. */
const shade = (x: number, y: number, r: number): Tone => {
  const d = (x - CENTRE + (y - CENTRE)) / r;

  if (d < -0.8) return "light";

  return d > 0.75 ? "shade" : "hue";
};

/** On the ring's pixel outline, and in front of the planet (or clear of it). */
const onRing = (x: number, y: number, ring: Ring, radius: number) => {
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  const u = dx * Math.cos(ring.tilt) + dy * Math.sin(ring.tilt);
  const v = -dx * Math.sin(ring.tilt) + dy * Math.cos(ring.tilt);
  const e = (u / ring.rx) ** 2 + (v / ring.ry) ** 2;

  return e >= 0.62 && e <= 1.05 && (v > 0 || !inDisc(x, y, radius + 0.4));
};

interface Shot {
  /** Which of the dish's rim cells light: none, every other one, or all. */
  readonly rim: "none" | "half" | "all";
  /** The tributary beams, rim to focus along the dish's diagonals. */
  readonly converge: boolean;
  /** How many cells the main beam reaches from the focus, diagonally up and to the left. */
  readonly beam: number;
  readonly focus: Tone;
}

/** The superlaser by frame: the rim lights, converges, fires, and the focus fades. */
const FIRING: readonly Shot[] = [
  { rim: "none", converge: false, beam: 0, focus: "light" },
  { rim: "half", converge: false, beam: 0, focus: "light" },
  { rim: "all", converge: false, beam: 0, focus: "glint" },
  { rim: "all", converge: true, beam: 0, focus: "laser" },
  { rim: "all", converge: true, beam: 3, focus: "laser" },
  { rim: "none", converge: true, beam: 5, focus: "laser" },
  { rim: "none", converge: false, beam: 5, focus: "laser" },
  { rim: "none", converge: false, beam: 0, focus: "glint" },
];

const shotAt = (frame: number | null): Shot | null =>
  frame === null ? null : (FIRING[frame] ?? null);

const onBeam = (x: number, y: number, p: Planet, shot: Shot | null) => {
  if (p.dish === undefined || shot === null) return false;
  const step = p.dish.x - x;

  return step > 0 && p.dish.y - y === step && step <= shot.beam;
};

const rimFires = (x: number, y: number, shot: Shot | null) =>
  shot !== null && (shot.rim === "all" || (shot.rim === "half" && mod(x + y, 2) === 0));

/** Squared distance from the focus at which the dish's outer ring begins. */
const RIM = 4;

const dishCell = (x: number, y: number, p: Planet, shot: Shot | null): Tone | null => {
  if (p.dish === undefined) return null;
  const d2 = (x - p.dish.x) ** 2 + (y - p.dish.y) ** 2;

  if (d2 > p.dish.r ** 2) return null;

  if (d2 === 0) return shot?.focus ?? "light";

  if (d2 >= RIM) return rimFires(x, y, shot) ? "laser" : "shade";

  return shot?.converge === true && d2 === 2 ? "laser" : "shade";
};

const planetCell = (x: number, y: number, p: Planet, frame: number | null): Tone | null => {
  const ringIndex = p.rings?.findIndex((ring) => onRing(x, y, ring, p.radius)) ?? -1;

  if (ringIndex >= 0) {
    const glint = frame !== null && mod(x + ringIndex * 3 - 2 * frame, CELESTIAL_FRAMES) === 0;

    return glint ? "glint" : "light";
  }

  const shot = p.dish === undefined ? null : shotAt(frame);

  if (onBeam(x, y, p, shot)) return "laser";

  if (!inDisc(x, y, p.radius)) return null;

  if (p.shadow !== undefined && inDisc(x - p.shadow.dx, y - p.shadow.dy, p.radius)) return "shade";

  const dish = dishCell(x, y, p, shot);

  if (dish !== null) return dish;

  if (p.marks?.(x - (frame ?? 0), y) === true) return "shade";

  return shade(x, y, p.radius);
};

/** Ray length by frame: a Working star pulses its rays out and back. */
const PULSE = [1, 0.85, 0.65, 0.5, 0.5, 0.65, 0.85, 1] as const;

const starCell = (x: number, y: number, s: Star, frame: number | null): Tone | null => {
  const dx = Math.abs(x - CENTRE);
  const dy = Math.abs(y - CENTRE);
  const scale = frame === null ? 1 : (PULSE[frame] ?? 1);

  if (inDisc(x, y, s.core)) return frame !== null && scale < 0.6 ? "glint" : "light";

  const axis = Math.min(dx, dy) < 1 ? Math.max(dx, dy) : null;
  const diagonal = Math.abs(dx - dy) < 0.5 ? dx * Math.SQRT2 : null;
  const [longRay, shortRay] = s.diagonal ? [diagonal, axis] : [axis, diagonal];

  for (const [ray, length] of [
    [longRay, s.long * scale],
    [shortRay, s.short * scale],
  ] as const) {
    if (ray !== null && length > 0 && ray <= length + 0.01)
      return ray <= length / 2 ? "hue" : "shade";
  }

  return null;
};

const cache = new Map<string, readonly Cell[]>();

/** A body's lit cells: still (frame null) or one frame of its Working loop. */
export function celestialCells(body: CelestialBody, frame: number | null = null): readonly Cell[] {
  const key = `${body}:${frame ?? "still"}`;
  const hit = cache.get(key);

  if (hit !== undefined) return hit;

  const form = formOf(body);
  const cells: Cell[] = [];

  for (let y = 0; y < CELESTIAL_GRID; y++) {
    for (let x = 0; x < CELESTIAL_GRID; x++) {
      const tone =
        form.kind === "star" ? starCell(x, y, form, frame) : planetCell(x, y, form, frame);

      if (tone !== null) cells.push({ x, y, tone });
    }
  }

  cache.set(key, cells);

  return cells;
}

const indexOf = (list: readonly string[], value: string | null | undefined) =>
  Math.max(0, value == null ? 0 : list.indexOf(value));

/** A Lead's star, from its planet, so a session keeps one star however often it leads. */
export const leadStar = (planet: CelestialBody | null | undefined): CelestialBody =>
  CELESTIAL_STARS[indexOf(CELESTIAL_PLANETS, planet) % CELESTIAL_STARS.length] ?? "star-cross";

/** A Subagent's moon, by its place among its parent's Subagents. */
export const subagentMoon = (index: number): CelestialBody =>
  CELESTIAL_MOONS[mod(index, CELESTIAL_MOONS.length)] ?? "moon-full";

/** The body a session shows: its star while it leads a Constellation, else its planet. */
export const sessionCelestial = (
  planet: CelestialBody | null | undefined,
  lead = false
): CelestialBody => (lead ? leadStar(planet) : (planet ?? CELESTIAL_PLANETS[0]));
