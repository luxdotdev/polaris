/** Hex colour helpers for the scene layer; every result is an opaque `#rrggbb`. */

type Rgb = readonly [number, number, number];

export const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1, 7), 16);

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved toward `b` by `t` (0–1). */
export const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a);
  const y = rgb(b);

  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};

/** A small seeded PRNG (mulberry32), so the model replays exactly in tests. */
export const seeded = (seed: number) => {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Random = () => number;

/** A uniform value in [lo, hi). */
export const between = (random: Random, lo: number, hi: number) => lo + random() * (hi - lo);
