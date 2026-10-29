/**
 * Which sheet the constellation screen shows: a star's task (MX-Z), all tasks (MX-X), a claim
 * (MX-AA) or the stats (MX-AB).
 */
import type { ReactNode } from "react";
import type { HostConnection } from "../../runtime/hostConnection.ts";
import { starCounts } from "../../starChart/index.ts";
import { ClaimSheet } from "../claim.tsx";
import type { ConstellationSource } from "../model.ts";
import { StatsSheetContent } from "../stats/index.ts";
import type { StatsState } from "../stats/useStats.ts";
import type { Verdicts } from "../useVerdicts.ts";
import type { StarChartData } from "./stars.ts";

export type OpenSheet =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "tasks" }
  | { readonly kind: "claim"; readonly taskId: string }
  | { readonly kind: "stats" }
  | null;

export interface SlotContext {
  readonly sheet: OpenSheet;
  readonly onClose: () => void;
  readonly source: ConstellationSource;
  readonly connection: HostConnection;
  readonly verdicts: Verdicts;
  readonly now: number;
  readonly chart: StarChartData;
  /** The screen's one `constellation.stats` read, shared with the chip and the card. */
  readonly stats: StatsState;
  /** The last claim opened, kept while its sheet closes so it doesn't blank mid-slide. */
  readonly lastClaim: string | null;
}

/** A task as the chart labels it ("B3"), so the sheets name it as the stars do. */
const labelIn = (chart: StarChartData, taskId: string | null): string | undefined =>
  chart.tasks.find((t) => t.id === taskId)?.label;

/** MX-AA: the claim sheet, from the task sheet's Review claim or the lead's claim notice. */
export const renderClaimSheet = (context: SlotContext): ReactNode => (
  <ClaimSheet
    open={context.sheet?.kind === "claim"}
    onClose={context.onClose}
    taskId={context.lastClaim}
    source={context.source}
    verdicts={context.verdicts}
    now={context.now}
    label={labelIn(context.chart, context.lastClaim)}
  />
);

/** MX-AB: the stats sheet, from the stats chip. */
export const renderStatsSheet = (context: SlotContext): ReactNode => (
  <StatsSheetContent
    open={context.sheet?.kind === "stats"}
    onClose={context.onClose}
    source={context.source}
    state={context.stats}
    waitingForYou={starCounts(context.chart.tasks).review}
    labelOf={(taskId) => labelIn(context.chart, taskId) ?? taskId}
  />
);
