/**
 * The stats sheet (Paper MX-AB) and completion card (MX-AC) as plain values: protocol
 * `ConstellationStats` with each Usage priced, read for a phone. Pure; the sheets render it.
 */
import type {
  Constellation,
  ConstellationStats,
  HarnessKind,
  StatsUsage,
  TaskProjection,
} from "@polaris/protocol";
import { shortSha, span } from "../copy.ts";

/** A Usage section's cost in USD, or null when part of it has no price. */
export type PriceUsage = (usage: StatsUsage) => number | null;

export type ReviewCell = "accepted" | "sent-back" | "waiting";

export interface WorkerRow {
  readonly taskId: string;
  readonly harness: HarnessKind | null;
  /** Of the longest row's working time, 0 to 1. */
  readonly share: number;
  readonly time: string;
}

export interface StatsSheetView {
  /** "cost" when anything is priced; otherwise the headline counts tokens. */
  readonly measure: "cost" | "tokens";
  readonly headline: string;
  readonly subline: string;
  /** Lead and workers, in that order, each with its share of the headline. */
  readonly roles: ReadonlyArray<{
    readonly role: "lead" | "worker";
    readonly label: string;
    readonly share: number;
  }>;
  readonly review: {
    readonly line: string;
    readonly cells: ReadonlyArray<ReviewCell>;
    readonly caption: string | null;
  };
  readonly workers: {
    readonly total: string | null;
    readonly rows: ReadonlyArray<WorkerRow>;
    /** "+ 5 more tasks · 1h 40m" past the longest rows. */
    readonly rest: string | null;
  };
}

export interface StatsInput {
  readonly stats: ConstellationStats;
  readonly constellation: Constellation;
  readonly price: PriceUsage;
  /** Claims handed to the user and not yet decided. */
  readonly waitingForYou: number;
}

const MINUTE = 60_000;

/** "0m", "31m", "1h", "2h 41m", "9d 4h". */
export const duration = (ms: number): string => span(Math.floor(Math.max(0, ms) / MINUTE));

const compact = (n: number, unit: number, suffix: string) => {
  const value = n / unit;

  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}${suffix}`;
};

/** "512", "86k", "2.4M", "1.2B". */
export const tokenCount = (n: number): string => {
  if (n >= 1_000_000_000) return compact(n, 1_000_000_000, "B");

  if (n >= 1_000_000) return compact(n, 1_000_000, "M");

  return n >= 1000 ? compact(n, 1000, "k") : String(Math.round(n));
};

/** "$4.82", "$12,345.67": thousands grouped, so a long run's cost still reads at a glance. */
export const usd = (n: number): string => {
  const [whole = "0", cents = "00"] = n.toFixed(2).split(".");

  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
};

const billed = (t: StatsUsage["tokens"]) => t.input + t.cacheRead + t.cacheWrite + t.output;

const tokensOf = (usage: StatsUsage) => billed(usage.tokens);

/** The reported cost when it covers every token; otherwise null, and the sheets count tokens. */
export const reportedPrice: PriceUsage = (usage) =>
  billed(usage.reportedTokens) >= billed(usage.tokens) ? usage.reportedUsd : null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Gates and leaf tasks, as the rail counts them: parents roll their children up. */
export const countedTasks = (c: Constellation) => {
  const parents = new Set(c.tasks.flatMap((t) => (t.parent == null ? [] : [t.parent])));

  return c.tasks.filter((t) => !t.canceled && !parents.has(t.id));
};

/** Past this many claims the meter's cells stand for shares, or each would be thinner than a hairline. */
export const MAX_CELLS = 40;

/** Counts scaled to fit `max` cells in total, each nonzero count keeping at least one. */
const fitted = (counts: ReadonlyArray<number>, max: number): ReadonlyArray<number> => {
  const total = counts.reduce((sum, n) => sum + n, 0);

  if (total <= max) return counts;

  return counts.map((n) => (n === 0 ? 0 : Math.max(1, Math.round((n / total) * max))));
};

const reviewOf = (stats: ConstellationStats, waiting: number): StatsSheetView["review"] => {
  const { acceptedFirstTime: accepted, firstClaimsReviewed: reviewed } = stats.review;
  const sentBack = Math.max(0, reviewed - accepted);

  const [a = 0, s = 0, w = 0] = fitted([accepted, sentBack, waiting], MAX_CELLS);

  const cells: Array<ReviewCell> = [
    ...Array.from({ length: a }, () => "accepted" as const),
    ...Array.from({ length: s }, () => "sent-back" as const),
    ...Array.from({ length: w }, () => "waiting" as const),
  ];

  const parts = [
    sentBack === 0 ? null : `${sentBack} sent back`,
    waiting === 0 ? null : `${waiting} waiting for you`,
  ].filter((p) => p !== null);

  return {
    line:
      reviewed === 0
        ? "No claims reviewed yet"
        : `${accepted} of ${plural(reviewed, "claim")} accepted first try`,
    cells,
    caption: parts.length === 0 ? null : parts.join(" · "),
  };
};

const SHOWN_WORKERS = 3;

const workersOf = (stats: ConstellationStats, c: Constellation): StatsSheetView["workers"] => {
  const byTask = new Map<string, number>();

  for (const a of stats.workers.attempts)
    byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + (a.times.workingMs ?? 0));

  const ranked = [...byTask].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]);
  const longest = ranked[0]?.[1] ?? 0;

  const harnessOf = (taskId: string) =>
    c.tasks.find((t) => t.id === taskId)?.suggested?.harness ?? null;

  const rest = ranked.slice(SHOWN_WORKERS);
  const restMs = rest.reduce((sum, [, ms]) => sum + ms, 0);
  const total = stats.workers.totals.workingMs;

  return {
    total: total === null ? null : duration(total),
    rows: ranked.slice(0, SHOWN_WORKERS).map(([taskId, ms]) => ({
      taskId,
      harness: harnessOf(taskId),
      share: longest === 0 ? 0 : ms / longest,
      time: duration(ms),
    })),
    rest: rest.length === 0 ? null : `+ ${plural(rest.length, "more task")} · ${duration(restMs)}`,
  };
};

const roleUsage = (stats: ConstellationStats, role: "lead" | "worker") =>
  stats.usage.perRole.find((r) => r.role === role)?.usage ?? null;

const ROLE_NAME = { lead: "Lead", worker: "Workers" } as const;

export const statsSheetView = ({
  stats,
  constellation,
  price,
  waitingForYou,
}: StatsInput): StatsSheetView => {
  const totalUsd = price(stats.usage.total) ?? 0;
  const totalTokens = tokensOf(stats.usage.total);
  const measure = totalUsd > 0 ? "cost" : "tokens";

  const amount = (usage: StatsUsage | null) => {
    if (usage === null) return 0;

    return measure === "cost" ? (price(usage) ?? 0) : tokensOf(usage);
  };

  const whole = measure === "cost" ? totalUsd : totalTokens;
  const show = (n: number) => (measure === "cost" ? usd(n) : tokenCount(n));

  const subline = [
    plural(countedTasks(constellation).length, "task"),
    `${duration(stats.wallClockMs)} since the plan`,
    measure === "cost" ? `${tokenCount(totalTokens)} tokens` : null,
  ].filter((p) => p !== null);

  return {
    measure,
    headline: show(whole),
    subline: subline.join(" · "),
    roles: (["lead", "worker"] as const).map((role) => {
      const n = amount(roleUsage(stats, role));

      return { role, label: `${ROLE_NAME[role]} ${show(n)}`, share: whole === 0 ? 0 : n / whole };
    }),
    review: reviewOf(stats, waitingForYou),
    workers: workersOf(stats, constellation),
  };
};

export interface CompletionRow {
  readonly label: string;
  readonly value: string;
}

export interface CompletionView {
  readonly kicker: string;
  readonly title: string;
  /** Cost, Time and Review need stats; Head needs an accepted gate. */
  readonly rows: ReadonlyArray<CompletionRow>;
}

/** The last accepted gate's claim: what the constellation merged up to. */
const finalHead = (c: Constellation): string | null => {
  const gates = new Set(c.tasks.filter((t) => t.kind === "gate").map((t) => t.id));

  const accepted = c.attempts.filter(
    (a) => gates.has(a.taskId) && a.state === "accepted" && a.claim != null
  );

  const last = accepted.at(-1)?.claim;

  return last == null ? null : `${shortSha(last.head)} · ${last.branch}`;
};

const statsRows = (stats: ConstellationStats, price: PriceUsage): ReadonlyArray<CompletionRow> => {
  const total = price(stats.usage.total) ?? 0;
  const lead = roleUsage(stats, "lead");
  const leadUsd = lead === null ? null : price(lead);
  const working = stats.workers.totals.workingMs;
  const { acceptedFirstTime, firstClaimsReviewed } = stats.review;

  const cost =
    total > 0
      ? `${usd(total)}${leadUsd === null ? "" : ` · lead ${usd(leadUsd)}`}`
      : `${tokenCount(tokensOf(stats.usage.total))} tokens`;

  return [
    { label: "Cost", value: cost },
    {
      label: "Time",
      value: [
        duration(stats.wallClockMs),
        working === null ? null : `${duration(working)} of workers`,
      ]
        .filter((p) => p !== null)
        .join(" · "),
    },
    ...(firstClaimsReviewed === 0
      ? []
      : [{ label: "Review", value: `${acceptedFirstTime} of ${firstClaimsReviewed} first try` }]),
  ];
};

export const completionView = (
  c: Constellation,
  projections: ReadonlyArray<TaskProjection>,
  stats: ConstellationStats | null,
  price: PriceUsage
): CompletionView => {
  const tasks = countedTasks(c);
  const states = new Map(projections.map((p) => [p.taskId, p.state]));
  const done = tasks.filter((t) => states.get(t.id) === "done").length;
  const head = finalHead(c);

  return {
    kicker: c.state === "archived" ? "Constellation archived" : "Constellation complete",
    title: `${done} of ${plural(tasks.length, "task")} accepted`,
    rows: [
      ...(stats === null ? [] : statsRows(stats, price)),
      ...(head === null ? [] : [{ label: "Head", value: head }]),
    ],
  };
};
