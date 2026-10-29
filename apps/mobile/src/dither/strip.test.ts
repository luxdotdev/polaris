import { describe, expect, test } from "bun:test";
import { DITHER_FRAMES, ditherFrameAt } from "@polaris/ui/dither";
import { type DitherArt, ditherSteps, ditherStill, ditherStrip } from "./strip.ts";

/** The art's lit cells as "x,y,alpha", read back from its paths. */
const cellsOf = (art: DitherArt): string[] =>
  art.layers
    .flatMap((layer) =>
      [...layer.d.matchAll(/M(\d+) (\d+)h2v2h-2z/g)].map(
        ([, x, y]) => `${x},${y},${layer.alpha.toFixed(2)}`
      )
    )
    .sort();

const expected = (size: number, frames: number, intensity?: number): string[] =>
  Array.from({ length: frames }, (_, frame) =>
    ditherFrameAt({ width: size, height: size }, frame, intensity).map(
      (cell) => `${cell.x + frame * size},${cell.y},${cell.alpha.toFixed(2)}`
    )
  )
    .flat()
    .sort();

describe("the dither strip", () => {
  test.each([
    [16, undefined],
    [14, undefined],
    [10, 0.9],
  ])("draws @polaris/ui's frames side by side at %ipt (intensity %p)", (size, intensity) => {
    expect(cellsOf(ditherStrip(size, intensity))).toEqual(expected(size, DITHER_FRAMES, intensity));
    expect(cellsOf(ditherStill(size, intensity))).toEqual(expected(size, 1, intensity));
  });

  test("steps a whole frame each twelfth of the clock, never between frames or past the last", () => {
    const { inputRange, outputRange } = ditherSteps(16);

    // React Native's native interpolation: the first segment whose end reaches t, linearly.
    const at = (t: number): number => {
      const end = Math.max(
        1,
        inputRange.findIndex((input, i) => i > 0 && input >= t)
      );

      const [x0 = 0, x1 = 0, y0 = 0, y1 = 0] = [
        inputRange[end - 1],
        inputRange[end],
        outputRange[end - 1],
        outputRange[end],
      ];

      return x1 === x0 ? y1 : y0 + ((t - x0) * (y1 - y0)) / (x1 - x0);
    };

    for (let i = 0; i < 1200; i++) {
      const t = (i + 0.5) / 1200;

      expect(at(t)).toBe(0 - 16 * Math.floor(t * DITHER_FRAMES));
    }
  });
});
