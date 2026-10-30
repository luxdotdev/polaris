import { describe, expect, test } from "bun:test";
import { scatterFits } from "./AgentStrip.tsx";

describe("the Working strip's scatter", () => {
  test("wanders a wide strip's free gap", () => {
    expect(scatterFits(1200, { from: 340, to: 990 })).toBe(true);
  });

  test.each([
    ["Follow and Stop", 720, { from: 330, to: 500 }],
    ["a long caption", 1200, { from: 640, to: 990 }],
  ])("stays off when it would run under %s", (_, width, gap) => {
    expect(scatterFits(width, gap)).toBe(false);
  });
});
