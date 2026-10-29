/**
 * Which sheet the constellation screen shows: a star's task (MX-Z), all tasks (MX-X), a claim
 * (MX-AA) or the stats (MX-AB). The claim and stats sheets are C2's; they fill the slots below.
 */
import type { ReactNode } from "react";
import type { HostConnection } from "../../runtime/hostConnection.ts";
import type { ConstellationSource } from "../model.ts";
import type { Verdicts } from "../useVerdicts.ts";

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
}

/** MX-AA: `ClaimSheet` from claim.tsx goes here. */
export const renderClaimSheet = (_context: SlotContext): ReactNode => null;

/** MX-AB: `StatsSheet` goes here. */
export const renderStatsSheet = (_context: SlotContext): ReactNode => null;
