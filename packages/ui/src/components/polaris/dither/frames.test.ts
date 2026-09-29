import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DITHER_FRAMES, ditherFrame, ditherStillMask, ditherStripMask } from "./frames";

const committed = readFileSync(
  new URL("../../../../../../design/assets/dither/dither-claude-16.svg", import.meta.url),
  "utf8"
);

describe("dither frames", () => {
  test("frame 0 matches design/assets/dither/dither-claude-16.svg cell for cell", () => {
    const expected = [
      ...committed.matchAll(/x="(\d+)" y="(\d+)"[^>]*fill-opacity="([\d.]+)"/g),
    ].map(([, x, y, alpha]) => `${x},${y},${alpha}`);

    const actual = ditherFrame({
      width: 16,
      height: 16,
      base: 0.2,
      amp: 0.6,
      k: 2.2,
      phase: 0,
    }).map((cell) => `${cell.x},${cell.y},${cell.alpha.toFixed(2)}`);

    expect(actual).toEqual(expected);
  });

  test("cells sit on the 2px grid", () => {
    for (const cell of ditherFrame({
      width: 24,
      height: 24,
      base: 0.2,
      amp: 0.6,
      k: 2.2,
      phase: 1,
    })) {
      expect(cell.x % 2).toBe(0);
      expect(cell.y % 2).toBe(0);
    }
  });

  test("the strip holds every frame side by side", () => {
    const strip = decodeURIComponent(ditherStripMask({ width: 16, height: 16 }));

    expect(strip).toContain(`width="${16 * DITHER_FRAMES}"`);
    expect(ditherStillMask({ width: 16, height: 16 })).toBe(
      ditherStillMask({ width: 16, height: 16 })
    );
  });
});
