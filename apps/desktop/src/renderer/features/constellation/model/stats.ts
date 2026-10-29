/**
 * Formatters, coverage notes and the completion card's tally from `constellation.stats` (C1-M),
 * priced in main; the charts are `statsPanel.ts`. A null metric is "not recorded", never zero.
 */
import type { ConstellationStatsView } from "../../../../shared/api.ts";
import type { Spend } from "../../settings/model/byConstellation.ts";
import { pluralize } from "./copy.ts";
import { childrenOf, isContainer, type Node } from "./tree.ts";

type Stats = ConstellationStatsView["stats"];

type Tokens = Stats["usage"]["total"]["tokens"];

const SECOND = 1000;

const MINUTE = 60 * SECOND;

/** "40s", "4m", "2h 5m". */
export const duration = (ms: number): string => {
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  const minutes = Math.round(ms / MINUTE);

  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;

  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
};

/** "$1.24", "<$0.01", "$0". */
export const usd = (value: number): string => {
  if (value === 0) return "$0";

  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
};

/** "182k", "1.4M", "940". */
export const tokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;

  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
};

export const totalTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite + t.output;

/** The first coverage reason for a metric (or its parent: `workers` covers `workers.idleMs`). */
export const reasonFor = (stats: Stats, metric: string) =>
  stats.coverage.find((c) => c.metric === metric || metric.startsWith(`${c.metric}.`))?.reason ??
  null;

export const costNote = (spend: Spend, priced: boolean) => {
  if (!priced) return "reported cost only; no price list was available";

  return spend.cost.partial ? "some tokens have no price" : null;
};

/** "MergeConflict" → "merge conflict": causes arrive as their tags. */
const causeWords = (cause: string) =>
  cause
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();

export const sendBacks = (stats: Stats) => {
  const causes = stats.review.sendBacksByCause.filter((c) => c.count > 0);

  return causes.length === 0
    ? "none"
    : causes.map((c) => `${c.count} ${causeWords(c.cause)}`).join(" · ");
};

/** What the popover's foot says about how complete the numbers are. */
export const statsCoverage = (view: ConstellationStatsView): ReadonlyArray<string> => {
  const notes = new Set<string>();

  if (view.stats.indexing)
    notes.add("Usage is still being indexed on this host; totals will grow.");

  for (const c of view.stats.coverage) if (c.metric === "usage") notes.add(c.reason);

  return [...notes];
};

/**
 * The completion card's tally: Tasks that carry Attempts (Gates included), never Parents or
 * canceled Tasks, so it shares its denominator with first-time acceptance.
 */
export const completionTally = (
  tasks: ReadonlyArray<Node>,
  projections: ReadonlyArray<{ readonly taskId: string; readonly state: string }>
) => {
  const children = childrenOf(tasks);
  const done = new Set(projections.flatMap((p) => (p.state === "done" ? [p.taskId] : [])));
  const counted = tasks.filter((t) => t.canceled !== true && !isContainer(children.get(t.id)));

  return { done: counted.filter((t) => done.has(t.id)).length, count: counted.length };
};

/** "18 of 18 tasks done". */
export const completionHeadline = (tally: { readonly done: number; readonly count: number }) =>
  `${tally.done} of ${pluralize(tally.count, "task")} done`;
