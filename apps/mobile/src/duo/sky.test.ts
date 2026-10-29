import { describe, expect, test } from "bun:test";
import { ridgePath, ridgeRise, SKY_FRAME } from "./sky.ts";

describe("the monitor's ridge", () => {
  // Where MX-AF stands its celestials: on the step under each one's centre.
  test.each([
    [100, 79],
    [205, 85],
    [330, 83],
    [452, 93],
    [582, 89],
  ])("at x %i of Paper's frame it rises %ipt", (x, rise) => {
    expect(ridgeRise(x, SKY_FRAME.width)).toBe(rise);
  });

  test("a wider sky stretches the ridge across, at the same heights", () => {
    expect(ridgeRise(200, SKY_FRAME.width * 2)).toBe(ridgeRise(100, SKY_FRAME.width));
    expect(ridgeRise(10_000, SKY_FRAME.width)).toBe(81);
  });

  test("its outline ends at the sky's right edge and the fill closes along the foot", () => {
    expect(ridgePath(669, 475, false).endsWith("H669")).toBe(true);
    expect(ridgePath(669, 500, true)).toMatch(/V500H0Z$/);
    expect(ridgePath(669, 500, false)).toContain("V401H");
  });
});
