/**
 * How the star chart fits the header's budget without cutting a band: waves while they fit,
 * else MX-X's dots, showing whole bands until the budget runs out.
 */
import { chartLayout, COMPRESS_PAST, DOTS, dotRowHeight, dotRows } from "../../starChart/layout.ts";
import type { StarTask } from "../../starChart/types.ts";
import type { StarChartData } from "./stars.ts";

export interface ChartFit {
  readonly compact: boolean;
  /** The tasks the chart draws: every task, or the whole bands that fit. */
  readonly tasks: ReadonlyArray<StarTask>;
  /** Bands left out for the budget; the list sheet has them all. */
  readonly hiddenBands: number;
}

/** Fits `chart` into `width` × `budget` points. */
export const chartFit = (chart: StarChartData, width: number, budget: number): ChartFit => {
  const waves =
    chart.tasks.length <= COMPRESS_PAST &&
    chartLayout(chart.tasks, chart.bands, width).height <= budget;

  if (waves) return { compact: false, tasks: chart.tasks, hiddenBands: 0 };
  const rows = dotRows(chart.tasks, chart.bands);
  let used = -DOTS.rowGap;
  let kept = 0;

  for (const row of rows) {
    used += DOTS.rowGap + dotRowHeight(row.tasks.length, width);

    if (used > budget && kept > 0) break;
    kept += 1;
  }

  const shown = new Set(rows.slice(0, kept).flatMap((row) => row.tasks.map((t) => t.id)));

  return {
    compact: true,
    tasks: chart.tasks.filter((t) => shown.has(t.id)),
    hiddenBands: rows.length - kept,
  };
};
