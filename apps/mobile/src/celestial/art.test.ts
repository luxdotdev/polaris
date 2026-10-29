import { describe, expect, test } from "bun:test";
import { CELESTIAL_MOONS, CELESTIAL_PLANETS, CELESTIAL_STARS } from "@polaris/protocol";
import { CELESTIAL_FRAMES, CELESTIAL_GRID, celestialCells } from "@polaris/ui/celestial";
import { type CelestialArt, celestialSteps, celestialStill, celestialStrip } from "./art.ts";

/** The art's lit cells as "x,y,tone", read back from its run rectangles. */
const cellsOf = (art: CelestialArt): string[] =>
  art.layers
    .flatMap((layer) =>
      [...layer.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].flatMap(([, x, y, w]) =>
        Array.from({ length: Number(w) }, (_, i) => `${Number(x) + i},${y},${layer.tone}`)
      )
    )
    .sort();

const expected = (body: string, frames: ReadonlyArray<number | null>): string[] =>
  frames
    .flatMap((frame, i) =>
      celestialCells(body, frame).map(
        (cell) => `${cell.x + i * CELESTIAL_GRID},${cell.y},${cell.tone}`
      )
    )
    .sort();

describe("the celestial art", () => {
  test.each([...CELESTIAL_PLANETS, ...CELESTIAL_STARS, ...CELESTIAL_MOONS])(
    "draws %s's cells, still and as the Working strip",
    (body) => {
      expect(cellsOf(celestialStill(body))).toEqual(expected(body, [null]));
      expect(cellsOf(celestialStrip(body))).toEqual(
        expected(
          body,
          Array.from({ length: CELESTIAL_FRAMES }, (_, frame) => frame)
        )
      );
    }
  );

  test("merges runs: a planet is a few dozen rectangles, not a square per cell", () => {
    const art = celestialStill("giant");
    const rects = art.layers.reduce((n, layer) => n + layer.d.split("M").length - 1, 0);

    expect(rects).toBeLessThan(celestialCells("giant").length / 3);
  });

  test("steps a whole frame each eighth of the clock, never between frames", () => {
    const { inputRange, outputRange } = celestialSteps(24);

    for (let i = 0; i < inputRange.length; i += 2) {
      expect(outputRange[i]).toBe(outputRange[i + 1]);
      expect(outputRange[i]).toBe(0 - (i / 2) * 24);
    }
  });
});
