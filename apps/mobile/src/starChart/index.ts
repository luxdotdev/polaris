/** The constellation star chart (Paper MX-W, compressing to MX-X past about 30 tasks). */
export { StarChart } from "./StarChart.tsx";

export { StarLegend, type StarLegendProps } from "./StarLegend.tsx";

export { COMPRESS_PAST, isCompact, taskCode } from "./layout.ts";

export { type StarCounts, starCounts } from "./legend.ts";

export type { StarBand, StarChartProps, StarState, StarTask } from "./types.ts";
