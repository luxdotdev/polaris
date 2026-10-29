import { expect, test } from "bun:test";
import { RIDGES } from "@polaris/ui/horizon";
import { cropLeft, moonLeft, MOON_SIZE, starsFor } from "./scene.ts";

/** Paper "Mobile chrome exploration", MX · Kit: the 393-wide horizon's ridges, back then front. */
const PAPER_RIDGES = [
  "M0,72 L0,23 L12,23 L12,21 L36,21 L36,20 L48,20 L48,24 L72,24 L72,26 L84,26 L84,24 L96,24 L96,26 L144,26 L144,28 L156,28 L156,30 L168,30 L168,26 L180,26 L180,22 L192,22 L192,24 L204,24 L204,22 L216,22 L216,24 L228,24 L228,22 L240,22 L240,24 L252,24 L252,28 L276,28 L276,26 L288,26 L288,24 L300,24 L300,26 L312,26 L312,30 L324,30 L324,34 L336,34 L336,32 L348,32 L348,30 L384,30 L384,34 L393,34 L393,72 Z",
  "M0,72 L0,56 L12,56 L12,54 L20,54 L20,58 L28,58 L28,56 L36,56 L36,58 L44,58 L44,60 L60,60 L60,62 L68,62 L68,64 L84,64 L84,60 L92,60 L92,56 L100,56 L100,58 L116,58 L116,54 L132,54 L132,56 L140,56 L140,54 L148,54 L148,52 L156,52 L156,54 L164,54 L164,52 L172,52 L172,50 L188,50 L188,54 L212,54 L212,58 L228,58 L228,60 L236,60 L236,58 L244,58 L244,60 L252,60 L252,64 L276,64 L276,60 L292,60 L292,64 L300,64 L300,62 L316,62 L316,60 L324,60 L324,62 L332,62 L332,64 L372,64 L372,62 L380,62 L380,60 L388,60 L388,56 L393,56 L393,72 Z",
] as const;

/** Paper's star rects at 393: [x, y, size, alpha byte]. */
const PAPER_STARS = {
  midnight: [
    [223, 42, 1, 0xb3],
    [253, 48, 2, 0x80],
    [267, 70, 2, 0x59],
    [305, 79, 1, 0x59],
    [253, 67, 1, 0xe6],
    [300, 59, 1, 0x80],
    [71, 79, 2, 0x80],
    [183, 75, 1, 0x80],
    [305, 41, 2, 0x80],
    [230, 29, 1, 0x59],
    [294, 36, 1, 0x80],
    [331, 52, 1, 0x80],
    [330, 86, 1, 0xb3],
    [241, 40, 1, 0x80],
    [241, 78, 1, 0x80],
    [241, 98, 1, 0xe6],
    [392, 60, 1, 0x59],
  ],
  moonlit: [
    [223, 42, 1, 0x7d],
    [305, 79, 1, 0x3d],
    [71, 79, 2, 0x59],
    [230, 29, 1, 0x3d],
    [331, 52, 1, 0x59],
    [330, 86, 1, 0x7d],
    [241, 40, 1, 0x59],
    [241, 78, 1, 0x59],
    [241, 98, 1, 0xa1],
    // Paper draws this one at Midnight's 0x59; the Desktop's 70% Moonlit dim gives 0x3e.
    [392, 60, 1, 0x3e],
  ],
} as const;

/** A stepped ridge path's top at column x (72, the box's foot, where it has none). */
const topAt = (d: string, x: number) => {
  const points = [...d.matchAll(/(\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

  const step = points.find(
    ([from, y], i) =>
      i > 0 && points[i + 1]?.[1] === y && x >= from && x < (points[i + 1]?.[0] ?? 0)
  );

  return step?.[1] ?? 72;
};

const profile = (d: string, left: number, width: number) =>
  Array.from({ length: width }, (_, x) => topAt(d, x + left));

test.each([0, 1] as const)("at 393 the crop of ridge %i is Paper's, point for point", (ridge) => {
  expect(profile(RIDGES[ridge], cropLeft(393), 393)).toEqual(profile(PAPER_RIDGES[ridge], 0, 393));
});

test.each([320, 393, 430])(
  "at %i the art stays 1:1 and centred where Paper centres it",
  (width) => {
    const left = cropLeft(width);
    const paperCentre = 492 + 393 / 2;

    expect(Number.isInteger(left)).toBe(true);
    expect(Math.abs(left + width / 2 - paperCentre)).toBeLessThanOrEqual(0.5);
    // The column under the screen's centre is the same art column Paper's centre shows.
    expect(topAt(RIDGES[0], left + Math.floor(width / 2))).toBe(topAt(PAPER_RIDGES[0], 196));
  }
);

test.each(["midnight", "moonlit"] as const)("at 393 %s's stars are Paper's", (theme) => {
  const placed = starsFor(theme, 393).map((s) => [s.x, s.y, s.size, s.opacity * 255]);
  const paper = PAPER_STARS[theme];

  expect(placed).toHaveLength(paper.length);

  for (const [x, y, size, alpha] of paper) {
    const star = placed.find(([px, py]) => px === x && py === y);
    expect(star?.slice(0, 3)).toEqual([x, y, size]);
    expect(Math.abs((star?.[3] ?? 0) - alpha)).toBeLessThanOrEqual(1.5);
  }
});

test.each([320, 430])(
  "at %i every star keeps its place over the ridge and stays on screen",
  (width) => {
    const art = (w: number) => starsFor("midnight", w).map((s) => `${s.x + cropLeft(w)},${s.y}`);
    const here = art(width);

    expect(here.length).toBeGreaterThan(0);
    const all = art(1440);
    expect(here.every((star) => all.includes(star))).toBe(true);

    for (const star of starsFor("midnight", width)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x + star.size).toBeLessThanOrEqual(width);
    }
  }
);

test("at 320 the moon still sits whole on screen", () => {
  expect(moonLeft(320)).toBeGreaterThanOrEqual(0);
  expect(moonLeft(320) + MOON_SIZE).toBeLessThanOrEqual(320);
});
