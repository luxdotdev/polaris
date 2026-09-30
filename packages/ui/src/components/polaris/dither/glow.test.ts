import { describe, expect, test } from "bun:test";

import { cellAlpha, FIELD_ALPHA, type FieldState, fieldValue, paintField, STILL } from "./glow";

const hovered = (x: number, y: number): FieldState => ({
  pointer: { x, y },
  presence: 1,
  ripples: [],
});

const litIn = (state: FieldState, columns: readonly number[], rows = 17) => {
  let lit = 0;

  for (const column of columns)
    for (let row = 0; row < rows; row++) if (cellAlpha(column, row, state) > 0) lit++;

  return lit;
};

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe("the Working strip's dither field", () => {
  test("still, it is a halo from the top-left that is gone by the middle", () => {
    expect(litIn(STILL, range(0, 40))).toBeGreaterThan(40);
    expect(litIn(STILL, range(120, 200))).toBe(0);
  });

  test("the pointer lights cells around it", () => {
    expect(litIn(hovered(320, 17), range(150, 170))).toBeGreaterThan(30);
    expect(litIn(hovered(320, 17), range(190, 200))).toBe(0);
  });

  test("presence scales the glow, so leaving fades it out", () => {
    const half = { ...hovered(320, 17), presence: 0.5 };

    expect(fieldValue(320, 17, half)).toBeCloseTo(fieldValue(320, 17, hovered(320, 17)) / 2);
    expect(fieldValue(320, 17, { ...half, presence: 0 })).toBe(0);
  });

  test("a ripple is a ring that grows and dies", () => {
    const at = (age: number): FieldState => ({ ...STILL, ripples: [{ x: 300, y: 17, age }] });

    expect(fieldValue(300 + 0.22 * 200, 17, at(200))).toBeGreaterThan(0.3);
    expect(fieldValue(300, 17, at(200))).toBeLessThan(0.01);
    expect(fieldValue(300 + 0.22 * 600, 17, at(600))).toBe(0);
  });

  test("it thins out toward the bottom edge", () => {
    const state = hovered(100, 30);

    expect(fieldValue(100, 33, state, 34)).toBeLessThan(fieldValue(100, 33, state) / 10);
    expect(fieldValue(100, 34, state, 34)).toBe(0);
  });

  test("alpha stays within the halo's range and paints the hue", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);

    paintField({ data, columns: 4, rows: 4 }, [10, 20, 30], hovered(4, 4));

    expect([...data.slice(0, 3)]).toEqual([10, 20, 30]);

    for (let at = 3; at < data.length; at += 4)
      expect(data[at] ?? 0).toBeLessThanOrEqual(Math.round(FIELD_ALPHA * 255));
  });
});
