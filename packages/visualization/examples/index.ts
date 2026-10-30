/** Hand-made Visualizations that pass validation; the Desktop and Mobile Apps use them as fixtures. */
import type { VisualizeInput } from "../src/index.ts";
import { comparison } from "./comparison.ts";
import { flowChart } from "./flow-chart.ts";
import { loanCalculator } from "./loan-calculator.ts";
import { timeline } from "./timeline.ts";

export { comparison, flowChart, loanCalculator, timeline };

export const VISUALIZATION_EXAMPLES = {
  "loan-calculator": loanCalculator,
  "flow-chart": flowChart,
  comparison,
  timeline,
} as const satisfies Readonly<Record<string, VisualizeInput>>;
