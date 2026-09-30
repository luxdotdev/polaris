import { describe, expect, test } from "bun:test";
import { clampWidth, defaultWidth, INTENT_MIN, MIN_WIDTH, widthCss } from "./layout.ts";

describe("output layout", () => {
  test("the default is 80% of what the old 448px Intent left", () => {
    // A 1512px window less the 264px sidebar: Output used to get 800px.
    expect(defaultWidth(1248)).toBe(640);
  });

  test("the panel keeps its minimum and leaves Intent its own", () => {
    expect(clampWidth(100, 1200)).toBe(MIN_WIDTH);
    expect(clampWidth(5000, 1200)).toBe(1200 - INTENT_MIN);
  });

  test("a stored width is clamped again in CSS", () => {
    expect(widthCss(null)).toContain("0.8");
    expect(widthCss(500)).toBe(`clamp(${MIN_WIDTH}px, 500px, calc(100% - ${INTENT_MIN}px))`);
  });
});
