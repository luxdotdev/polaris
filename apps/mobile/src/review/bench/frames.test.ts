import { describe, expect, test } from "bun:test";
import { displayBudget, frameStats } from "./frames.ts";

describe("frame statistics", () => {
  test("a frame is dropped only past 1.5× the budget", () => {
    const stats = frameStats([8.3, 8.4, 12.4, 12.6, 25], 8.33);

    expect(stats.dropped).toBe(2);
    expect(stats.max).toBe(25);
  });

  test("the budget is the idle median, so one long idle frame doesn't move it", () => {
    expect(displayBudget([16.7, 16.6, 16.7, 50, 16.6])).toBe(16.7);
  });

  test("percentiles read from the sorted intervals", () => {
    const intervals = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = frameStats(intervals, 16.7);

    expect([stats.p50, stats.p95, stats.p99]).toEqual([50, 95, 99]);
  });
});
