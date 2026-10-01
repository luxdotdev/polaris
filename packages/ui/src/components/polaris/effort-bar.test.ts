import { describe, expect, test } from "bun:test";

import { effortKey, effortStep, segmentWidth } from "./effort-bar";

describe("the effort bar", () => {
  test("the lowest level is still and sparse; each step up is denser and faster", () => {
    const steps = [0, 1, 2, 3, 4].map((i) => effortStep(i, 5));

    expect(steps[0]?.frameMs).toBeNull();
    expect(steps[0]?.intensity).toBeCloseTo(0.15);
    expect(steps[4]).toEqual({ intensity: 1, frameMs: 70 });

    for (let i = 2; i < steps.length; i++) {
      expect(steps[i]?.intensity ?? 0).toBeGreaterThan(steps[i - 1]?.intensity ?? 1);
      expect(steps[i]?.frameMs ?? 0).toBeLessThan(steps[i - 1]?.frameMs ?? 0);
    }
  });

  test("arrows step, Home and End jump, and the ends hold", () => {
    expect(effortKey("ArrowRight", 1, 5)).toBe(2);
    expect(effortKey("ArrowLeft", 1, 5)).toBe(0);
    expect(effortKey("Home", 3, 5)).toBe(0);
    expect(effortKey("End", 1, 6)).toBe(5);
    expect(effortKey("ArrowRight", 4, 5)).toBeNull();
    expect(effortKey("ArrowLeft", 0, 5)).toBeNull();
    expect(effortKey("Enter", 2, 5)).toBeNull();
  });

  test("segments sit on the 2px cell grid", () => {
    for (const n of [1, 3, 4, 5, 6]) expect(segmentWidth(n) % 2).toBe(0);
  });
});
