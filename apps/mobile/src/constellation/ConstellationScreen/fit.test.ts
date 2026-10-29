import { expect, test } from "bun:test";
import { chartLayout, dotRowHeight, dotRows } from "../../starChart/layout.ts";
import { galleryConstellation, NOW } from "./fixtures.testing.ts";
import { chartFit } from "./fit.ts";
import { starChartOf } from "./stars.ts";
import { stressConstellation } from "./worstCase.testing.ts";

const lead = { sessionId: "lead", hostId: "mac" };

const WIDTH = 317;

const chartOf = (dataset: "done" | "worst") =>
  starChartOf(stressConstellation(dataset, lead, NOW).source);

test("waves that fit the budget draw every task as stars", () => {
  const chart = starChartOf(galleryConstellation("header", lead, NOW));

  expect(chartFit(chart, WIDTH, 400)).toEqual({
    compact: false,
    tasks: chart.tasks,
    hiddenBands: 0,
  });
});

test("waves taller than the budget compress to dots instead of clipping a band", () => {
  // Done: 21 tasks in five bands, whose waves stand taller than a small screen's share.
  const chart = chartOf("done");
  const waves = chartLayout(chart.tasks, chart.bands, WIDTH).height;
  const fit = chartFit(chart, WIDTH, waves - 1);

  expect(fit.compact).toBe(true);
  expect(fit.tasks).toHaveLength(chart.tasks.length);
});

test("dots past the budget show only whole bands and count the rest", () => {
  const chart = chartOf("worst");
  const rows = dotRows(chart.tasks, chart.bands);
  const fit = chartFit(chart, WIDTH, 150);
  const kept = rows.length - fit.hiddenBands;

  const height = (n: number) =>
    rows.slice(0, n).reduce((sum, row) => sum + dotRowHeight(row.tasks.length, WIDTH), 0) +
    (n - 1) * 8;

  expect(fit.hiddenBands).toBeGreaterThan(0);
  expect(height(kept)).toBeLessThanOrEqual(150);
  expect(height(kept + 1)).toBeGreaterThan(150);
  expect(new Set(fit.tasks.map((t) => t.band)).size).toBe(kept);
});

test("a budget smaller than one band still shows the first band", () => {
  const fit = chartFit(chartOf("worst"), WIDTH, 1);

  expect(fit.tasks.length).toBeGreaterThan(0);
  expect(new Set(fit.tasks.map((t) => t.band)).size).toBe(1);
});
