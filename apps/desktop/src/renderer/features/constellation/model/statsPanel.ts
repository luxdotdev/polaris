/**
 * The Stats popover as charts (ENG-470): a headline split by role, workers' time as one stacked
 * bar, first Claims as cells, a column per update turn, and the costliest Tasks, in cost or tokens.
 */
import type { ConstellationStatsView, PricedStatsUsage } from "../../../../shared/api.ts";
import { type Spend, statsSpend } from "../../settings/model/byConstellation.ts";
import { pluralize } from "./copy.ts";
import { costNote, duration, reasonFor, sendBacks, tokens, totalTokens, usd } from "./stats.ts";

type Stats = ConstellationStatsView["stats"];

/** What spend is measured in; tokens when nothing could be priced. */
export type Measure = "cost" | "tokens";

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** The Harness with the most tokens in a section; null when it has none. */
export const dominantHarness = (usage: PricedStatsUsage): string | null => {
  const byHarness = new Map<string, number>();

  for (const b of usage.buckets)
    byHarness.set(b.harness, (byHarness.get(b.harness) ?? 0) + totalTokens(b.tokens));

  let best: string | null = null;
  let most = 0;

  for (const [harness, n] of byHarness)
    if (n > most) {
      best = harness;
      most = n;
    }

  return best;
};

export interface Headline {
  /** "Cost · estimated at API prices", or why it is incomplete. */
  readonly caption: string;
  /** "$174.55" or "489.5M". */
  readonly primary: string;
  /** "tokens" after a token count; null after money. */
  readonly unit: string | null;
  /** The other measure and the wall clock. */
  readonly secondary: string;
}

export interface RoleShare {
  readonly role: "lead" | "worker";
  readonly label: string;
  /** In the panel's measure. */
  readonly value: string;
  /** In the other measure. */
  readonly detail: string;
  readonly share: number;
  readonly harness: string | null;
}

export interface TimeSegment {
  readonly key: "working" | "idle" | "slot" | "lease" | "offline";
  readonly label: string;
  /** Null when not recorded. */
  readonly ms: number | null;
  readonly text: string;
  /** Of the recorded time. */
  readonly share: number;
  readonly note: string | null;
}

export interface WorkerTime {
  readonly harness: string | null;
  readonly segments: ReadonlyArray<TimeSegment>;
}

export interface ReviewChart {
  /** One per first Claim reviewed: accepted first time, then the rest. */
  readonly cells: ReadonlyArray<{ readonly id: string; readonly accepted: boolean }>;
  readonly summary: string;
  readonly rate: string | null;
  readonly claimToReview: string;
  readonly sentBack: string;
}

export interface DigestColumn {
  /** The first update turn it covers, from 1. */
  readonly id: string;
  /** Of the tallest column, 0–1. */
  readonly height: number;
  readonly label: string;
}

export interface LeadChart {
  readonly title: string;
  readonly columns: ReadonlyArray<DigestColumn>;
  readonly measure: Measure;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly note: string | null;
}

export interface TaskBar {
  readonly taskId: string;
  readonly title: string;
  readonly value: string;
  readonly share: number;
}

export interface StatsPanel {
  /** The measure shown: the one asked for, or tokens when nothing is priced. */
  readonly measure: Measure;
  readonly priced: boolean;
  readonly headline: Headline;
  readonly roles: ReadonlyArray<RoleShare>;
  readonly workers: WorkerTime;
  readonly review: ReviewChart;
  readonly lead: LeadChart;
  readonly tasks: ReadonlyArray<TaskBar>;
}

const headlineOf = (view: ConstellationStatsView, measure: Measure): Headline => {
  const total = statsSpend(view.usage.total);
  const note = costNote(total, view.pricesFetchedAt !== null);
  const cost = usd(total.cost.usd);
  const count = tokens(totalTokens(view.stats.usage.total.tokens));
  const wall = `${duration(view.stats.wallClockMs)} wall clock`;

  if (measure === "tokens")
    return {
      caption: "Tokens · input, cache and output",
      primary: count,
      unit: "tokens",
      secondary: [...(total.cost.usd > 0 ? [cost] : []), wall].join(" · "),
    };

  return {
    caption: `Cost · ${note ?? (total.cost.estimated ? "estimated at API prices" : "reported by harnesses")}`,
    primary: cost,
    unit: null,
    secondary: `${count} tokens · ${wall}`,
  };
};

const amount = (measure: Measure, spend: Spend) =>
  measure === "cost" ? spend.cost.usd : spend.tokens;

const amountText = (measure: Measure, spend: Spend) =>
  measure === "cost" ? usd(spend.cost.usd) : `${tokens(spend.tokens)} tokens`;

const other = (measure: Measure): Measure => (measure === "cost" ? "tokens" : "cost");

const ROLE_LABEL = { lead: "Lead", worker: "Workers" } as const;

const rolesOf = (view: ConstellationStatsView, measure: Measure): ReadonlyArray<RoleShare> => {
  const spends = view.usage.perRole.map((r) => ({ ...r, spend: statsSpend(r.usage) }));
  const all = spends.reduce((sum, r) => sum + amount(measure, r.spend), 0);

  return spends.map((r) => ({
    role: r.role,
    label: ROLE_LABEL[r.role],
    value: amountText(measure, r.spend),
    detail: amountText(other(measure), r.spend),
    share: share(amount(measure, r.spend), all),
    harness: dominantHarness(r.usage),
  }));
};

const TIMES = [
  ["working", "Working", "workers.workingMs", "workingMs"],
  ["idle", "Idle", "workers.idleMs", "idleMs"],
  ["slot", "Waiting for a slot", "workers.waitingForSlotMs", "waitingForSlotMs"],
  ["lease", "Waiting on a lease", "workers.waitingOnLeaseMs", "waitingOnLeaseMs"],
  ["offline", "Host offline", "workers.staleMs", "staleMs"],
] as const;

const workersOf = (view: ConstellationStatsView): WorkerTime => {
  const { stats } = view;
  const totals = stats.workers.totals;
  const recorded = TIMES.reduce((sum, [, , , field]) => sum + (totals[field] ?? 0), 0);
  const worker = view.usage.perRole.find((r) => r.role === "worker");

  return {
    harness: worker === undefined ? null : dominantHarness(worker.usage),
    segments: TIMES.map(([key, label, metric, field]) => {
      const ms = totals[field];

      return {
        key,
        label,
        ms,
        text: ms === null ? "not recorded" : duration(ms),
        share: ms === null ? 0 : share(ms, recorded),
        note: ms === null ? reasonFor(stats, metric) : null,
      };
    }),
  };
};

const reviewOf = (stats: Stats): ReviewChart => {
  const r = stats.review;
  const reviewed = r.firstClaimsReviewed;

  return {
    cells: Array.from({ length: reviewed }, (_, i) => ({
      id: `claim-${i + 1}`,
      accepted: i < r.acceptedFirstTime,
    })),
    summary:
      reviewed === 0
        ? "No claim reviewed yet"
        : `${r.acceptedFirstTime} of ${reviewed} accepted first time`,
    rate: r.firstTimeAcceptanceRate === null ? null : percent(r.firstTimeAcceptanceRate),
    claimToReview:
      r.medianClaimToReviewMs === null
        ? "no claim decided yet"
        : [
            `${duration(r.medianClaimToReviewMs)} median`,
            ...(r.meanClaimToReviewMs === null ? [] : [`${duration(r.meanClaimToReviewMs)} mean`]),
          ].join(" · "),
    sentBack: sendBacks(stats),
  };
};

/** At most this many columns; more digests are summed into equal runs. */
export const MAX_COLUMNS = 60;

interface Digest {
  readonly items: number;
  readonly tokens: number;
  readonly usd: number;
}

const columnLabel = (from: number, run: ReadonlyArray<Digest>) => {
  const sum = (f: (d: Digest) => number) => run.reduce((n, d) => n + f(d), 0);

  const which =
    run.length === 1 ? `Update turn ${from + 1}` : `Update turns ${from + 1}–${from + run.length}`;

  const cost = sum((d) => d.usd);

  return [
    which,
    pluralize(
      sum((d) => d.items),
      "update"
    ),
    `${tokens(sum((d) => d.tokens))} tokens`,
    ...(cost > 0 ? [usd(cost)] : []),
  ].join(" · ");
};

const columnsOf = (digests: ReadonlyArray<Digest>, measure: "cost" | "tokens") => {
  const size = Math.max(1, Math.ceil(digests.length / MAX_COLUMNS));

  const runs = Array.from({ length: Math.ceil(digests.length / size) }, (_, i) =>
    digests.slice(i * size, (i + 1) * size)
  );

  const values = runs.map((run) =>
    run.reduce((n, d) => n + (measure === "cost" ? d.usd : d.tokens), 0)
  );

  const max = Math.max(0, ...values);

  return runs.map((run, i) => ({
    id: String(i * size + 1),
    height: share(values[i] ?? 0, max),
    label: columnLabel(i * size, run),
  }));
};

const leadOf = (view: ConstellationStatsView, measure: Measure): LeadChart => {
  const { lead } = view.stats;

  const digests = lead.digests.map((d, i) => {
    const priced = view.usage.perDigest[i];

    return {
      items: d.items,
      tokens: totalTokens(d.usage.tokens),
      usd: priced === undefined ? 0 : statsSpend(priced).cost.usd,
    };
  });

  const meanUsd =
    digests.length === 0 ? 0 : digests.reduce((n, d) => n + d.usd, 0) / digests.length;

  const perTurn =
    lead.meanTokensPerDigest === null
      ? "not recorded"
      : [`${tokens(lead.meanTokensPerDigest)} tokens`, ...(meanUsd > 0 ? [usd(meanUsd)] : [])].join(
          " · "
        );

  return {
    title: pluralize(lead.wakeups, "update turn"),
    columns: columnsOf(digests, measure),
    measure,
    facts: [
      {
        label: "Updates per turn",
        value: lead.wakeups === 0 ? "none yet" : (lead.deliveredItems / lead.wakeups).toFixed(1),
      },
      ...(lead.coalescingHitRate === null
        ? []
        : [{ label: "Batched", value: percent(lead.coalescingHitRate) }]),
      { label: "Per update turn", value: perTurn },
    ],
    note: lead.meanTokensPerDigest === null ? reasonFor(view.stats, "lead.digests") : null,
  };
};

const tasksOf = (
  view: ConstellationStatsView,
  title: (taskId: string) => string,
  measure: Measure
): ReadonlyArray<TaskBar> => {
  const top = view.usage.perTask
    .map((t) => {
      const spend = statsSpend(t.usage);

      return { taskId: t.taskId, spend, n: amount(measure, spend) };
    })
    .filter((t) => t.n > 0)
    .toSorted((a, b) => b.n - a.n)
    .slice(0, 5);

  const max = top[0]?.n ?? 0;

  return top.map((t) => ({
    taskId: t.taskId,
    title: title(t.taskId),
    value: measure === "cost" ? usd(t.spend.cost.usd) : tokens(t.spend.tokens),
    share: share(t.n, max),
  }));
};

/** The popover's charts in `asked`. `title` names a Task for the costliest list. */
export const statsPanel = (
  view: ConstellationStatsView,
  title: (taskId: string) => string,
  asked: Measure = "cost"
): StatsPanel => {
  const priced = statsSpend(view.usage.total).cost.usd > 0;
  const measure = priced ? asked : "tokens";

  return {
    measure,
    priced,
    headline: headlineOf(view, measure),
    roles: rolesOf(view, measure),
    workers: workersOf(view),
    review: reviewOf(view.stats),
    lead: leadOf(view, measure),
    tasks: tasksOf(view, title, measure),
  };
};
