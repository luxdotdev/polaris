/**
 * Formatters, the completion card and coverage notes from `constellation.stats` (C1-M), priced in
 * main; the popover's charts are `statsPanel.ts`. A null metric is "not recorded", never zero.
 */
import type { ConstellationStatsView } from "../../../../shared/api.ts";
import { type Spend, statsSpend } from "../../settings/model/byConstellation.ts";
import { pluralize } from "./copy.ts";

type Stats = ConstellationStatsView["stats"];

type Tokens = Stats["usage"]["total"]["tokens"];

export interface StatLine {
  readonly label: string;
  readonly value: string;
  /** Why it isn't recorded, or a qualifier ("reported cost only"). */
  readonly note: string | null;
  /** True when the value is "not recorded". */
  readonly missing: boolean;
}

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

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

const NOT_RECORDED = "not recorded";

/** The first coverage reason for a metric (or its parent: `workers` covers `workers.idleMs`). */
export const reasonFor = (stats: Stats, metric: string) =>
  stats.coverage.find((c) => c.metric === metric || metric.startsWith(`${c.metric}.`))?.reason ??
  null;

const line = (label: string, value: string, note: string | null = null): StatLine => ({
  label,
  value,
  note,
  missing: false,
});

const maybe = (
  stats: Stats,
  label: string,
  metric: string,
  value: number | null,
  format: (n: number) => string
): StatLine =>
  value === null
    ? { label, value: NOT_RECORDED, note: reasonFor(stats, metric), missing: true }
    : line(label, format(value));

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

const firstTime = (stats: Stats) => {
  const { acceptedFirstTime, firstClaimsReviewed, firstTimeAcceptanceRate } = stats.review;

  if (firstClaimsReviewed === 0 || firstTimeAcceptanceRate === null) return null;

  return `${acceptedFirstTime} of ${firstClaimsReviewed} · ${percent(firstTimeAcceptanceRate)}`;
};

/** What the popover's foot says about how complete the numbers are. */
export const statsCoverage = (view: ConstellationStatsView): ReadonlyArray<string> => {
  const notes = new Set<string>();

  if (view.stats.indexing)
    notes.add("Usage is still being indexed on this host; totals will grow.");

  for (const c of view.stats.coverage) if (c.metric === "usage") notes.add(c.reason);

  return [...notes];
};

export interface CompletionFacts {
  readonly headline: string;
  readonly lines: ReadonlyArray<StatLine>;
}

/** The completion summary card: the few numbers that say how the Constellation went. */
export const completionFacts = (
  view: ConstellationStatsView,
  done: number,
  count: number
): CompletionFacts => {
  const { stats } = view;
  const first = firstTime(stats);
  const spend = statsSpend(view.usage.total);

  return {
    headline: `${done} of ${pluralize(count, "task")} done in ${duration(stats.wallClockMs)}`,
    lines: [
      line("Cost", usd(spend.cost.usd), costNote(spend, view.pricesFetchedAt !== null)),
      line("Tokens", tokens(totalTokens(stats.usage.total.tokens))),
      line("Accepted first time", first ?? "no Claim reviewed"),
      line("Sent back", sendBacks(stats)),
      maybe(
        stats,
        "Workers working",
        "workers.workingMs",
        stats.workers.totals.workingMs,
        duration
      ),
      line("Lead turns from updates", String(stats.lead.wakeups)),
    ],
  };
};
