/**
 * Compare a result against a baseline, metric by metric, with per-kind tolerances.
 *
 * A metric regresses when it is worse than the baseline's median by more than
 * max(relative × baseline, absolute). The defaults below were chosen from the
 * spread seen between repeated runs on one machine (see README "Tolerances"):
 * memory is steady run to run (a few MiB), so it is held tightly; CPU at low load
 * and tail latencies swing by tens of percent, so they are held loosely.
 */
import type { AggregatedMetric, BenchResult, MetricKind, ScenarioResult } from "./types.ts";

export const DEFAULT_TOLERANCE: Record<MetricKind, { relative: number; absolute: number }> = {
  memory: { relative: 0.1, absolute: 5 },
  cpu: { relative: 0.5, absolute: 2 },
  latency: { relative: 0.5, absolute: 5 },
  time: { relative: 0.35, absolute: 5 },
  throughput: { relative: 0.3, absolute: 0 },
  count: { relative: 0.25, absolute: 1 },
};

export type Status = "ok" | "regressed" | "improved" | "new" | "missing";

export interface ComparisonRow {
  readonly scenario: string;
  readonly metric: string;
  readonly unit: string;
  readonly kind: MetricKind | null;
  readonly baseline: number | null;
  readonly current: number | null;
  /** Relative change, positive = worse. */
  readonly change: number | null;
  readonly allowed: number | null;
  readonly status: Status;
  /** Counted toward the exit status (its kind is in `failOn` and it is not informational). */
  readonly gating: boolean;
}

export interface Comparison {
  readonly rows: ReadonlyArray<ComparisonRow>;
  readonly regressions: ReadonlyArray<ComparisonRow>;
  readonly warnings: ReadonlyArray<string>;
}

export interface MetricComparison {
  readonly status: Status;
  readonly change: number;
  readonly allowed: number;
}

export const compareMetric = (
  base: AggregatedMetric,
  current: AggregatedMetric
): MetricComparison => {
  const tolerance = current.tolerance ?? base.tolerance ?? DEFAULT_TOLERANCE[current.kind];
  const sign = current.better === "lower" ? 1 : -1;
  const worsening = sign * (current.value - base.value);
  const allowed = Math.max(tolerance.relative * Math.abs(base.value), tolerance.absolute);

  const change =
    base.value === 0
      ? worsening === 0
        ? 0
        : Math.sign(worsening)
      : worsening / Math.abs(base.value);

  if (worsening > allowed) return { status: "regressed", change, allowed };

  if (-worsening > allowed) return { status: "improved", change, allowed };

  return { status: "ok", change, allowed };
};

/** Differences in how the two results were produced that make them less comparable. */
const environmentWarnings = (baseline: BenchResult, current: BenchResult): Array<string> => {
  const warnings: Array<string> = [];

  if (baseline.env.machineSlug !== current.env.machineSlug) {
    warnings.push(
      `baseline is from ${baseline.env.machineSlug}, this run is ${current.env.machineSlug}: numbers are not comparable`
    );
  }

  if (baseline.options.quick !== current.options.quick) {
    warnings.push(
      `baseline ran ${baseline.options.quick ? "--quick" : "full"}, this run ${current.options.quick ? "--quick" : "full"}: sizes differ`
    );
  }

  if (baseline.env.daemon !== current.env.daemon) {
    warnings.push(
      `baseline ran the ${baseline.env.daemon} Daemon, this run the ${current.env.daemon} one`
    );
  }

  if (baseline.env.transport !== current.env.transport) {
    warnings.push(
      `baseline used the ${baseline.env.transport} transport, this run ${current.env.transport}`
    );
  }

  if (current.options.profile)
    warnings.push("this run was profiled: timings include profiler overhead");

  return warnings;
};

/** One scenario's rows: every current metric against the baseline, then those it lost. */
const scenarioRows = (
  scenario: string,
  result: ScenarioResult,
  base: ScenarioResult | undefined,
  failOn: ReadonlySet<MetricKind>
): Array<ComparisonRow> => {
  const rows: Array<ComparisonRow> = [];

  for (const [metric, m] of Object.entries(result.metrics)) {
    const b = base?.metrics[metric];

    if (b === undefined) {
      rows.push({
        scenario,
        metric,
        unit: m.unit,
        kind: m.kind,
        baseline: null,
        current: m.value,
        change: null,
        allowed: null,
        status: "new",
        gating: false,
      });
      continue;
    }

    const { status, change, allowed } = compareMetric(b, m);
    rows.push({
      scenario,
      metric,
      unit: m.unit,
      kind: m.kind,
      baseline: b.value,
      current: m.value,
      change,
      allowed,
      status,
      gating: failOn.has(m.kind) && !m.info && !b.info,
    });
  }

  for (const [metric, b] of Object.entries(base?.metrics ?? {})) {
    if (result.metrics[metric] !== undefined) continue;
    rows.push({
      scenario,
      metric,
      unit: b.unit,
      kind: b.kind,
      baseline: b.value,
      current: null,
      change: null,
      allowed: null,
      status: "missing",
      gating: false,
    });
  }

  return rows;
};

export const compare = (
  baseline: BenchResult,
  current: BenchResult,
  failOn: ReadonlySet<MetricKind>
): Comparison => {
  const rows = Object.entries(current.scenarios).flatMap(([scenario, result]) =>
    scenarioRows(scenario, result, baseline.scenarios[scenario], failOn)
  );

  return {
    rows,
    regressions: rows.filter((r) => r.status === "regressed" && r.gating),
    warnings: environmentWarnings(baseline, current),
  };
};
