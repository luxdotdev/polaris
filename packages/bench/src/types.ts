/** The shape of benchmark results, shared by scenarios, reports and comparisons. */
import type { Effect, Scope } from "effect";
import type { Daemon, LaunchOptions, TransportKind } from "./daemon.ts";
import type { Sampler } from "./sampler.ts";

/**
 * What a metric measures; picks its default tolerance in `compare.ts`.
 * memory: MiB; cpu: % of one core; latency/time: ms; throughput: per second; count: plain number.
 */
export type MetricKind = "memory" | "cpu" | "latency" | "time" | "throughput" | "count";

export interface Metric {
  readonly value: number;
  readonly unit: string;
  readonly kind: MetricKind;
  readonly better: "lower" | "higher";
  /** Overrides the kind's tolerance: allowed relative and absolute worsening. */
  readonly tolerance?: { readonly relative: number; readonly absolute: number };
  /** Informational only: never counted as a regression. */
  readonly info?: boolean;
}

/** One run of one scenario. */
export interface ScenarioRun {
  readonly metrics: Record<string, Metric>;
  readonly notes: ReadonlyArray<string>;
}

/** A metric aggregated over runs: `value` is the median. */
export interface AggregatedMetric extends Metric {
  readonly runs: ReadonlyArray<number>;
  readonly min: number;
  readonly max: number;
}

export interface ScenarioResult {
  readonly metrics: Record<string, AggregatedMetric>;
  readonly notes: ReadonlyArray<string>;
  readonly durationMs: number;
  readonly error?: string;
}

export interface Environment {
  readonly machine: string;
  readonly machineSlug: string;
  readonly cpu: string;
  readonly cores: number;
  readonly memoryGiB: number;
  readonly os: string;
  readonly arch: string;
  readonly bun: string;
  readonly gitSha: string;
  readonly gitDirty: boolean;
  readonly daemon: "source" | "compiled";
  readonly daemonBinary: string | null;
  readonly transport: TransportKind;
  readonly sampler: string;
  readonly date: string;
}

export interface BenchResult {
  readonly schema: 1;
  readonly env: Environment;
  readonly options: {
    readonly quick: boolean;
    readonly runs: number;
    readonly profile: boolean;
    readonly scenarios: ReadonlyArray<string>;
  };
  readonly scenarios: Record<string, ScenarioResult>;
}

export interface ScenarioContext {
  readonly quick: boolean;
  readonly transport: TransportKind;
  /** Where profiles and heap snapshots go for this run; null without --profile. */
  readonly profileDir: string | null;
  readonly log: (message: string) => void;
  /** Launch a Daemon that is stopped (and its home removed) when the scenario ends. */
  readonly launch: (options?: Partial<LaunchOptions>) => Effect.Effect<Daemon, never, Scope.Scope>;
  /** A sampler over this Daemon's process tree, stopped when the scenario ends. */
  readonly sample: (
    daemon: Daemon,
    intervalMs?: number
  ) => Effect.Effect<Sampler, never, Scope.Scope>;
  /** Take a heap snapshot now if profiling (a peak moment); no-op otherwise. */
  readonly peak: (daemon: Daemon, label: string) => Effect.Effect<void>;
}

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly run: (ctx: ScenarioContext) => Effect.Effect<ScenarioRun, unknown, Scope.Scope>;
}

// ── Metric constructors ─────────────────────────────────────────────────────

const MiB = 1024 * 1024;

export const memory = (bytes: number, extra: Partial<Metric> = {}): Metric => ({
  value: bytes / MiB,
  unit: "MiB",
  kind: "memory",
  better: "lower",
  ...extra,
});
/**
 * Memory at a peak, grown over a run, or left after activity depends on when the
 * garbage collector ran: runs of the same build spread by 15–30%, so it is held
 * to 25% / 10 MiB instead of the steady-state 10% / 5 MiB.
 */
export const PEAK_TOLERANCE = { relative: 0.25, absolute: 10 } as const;

export const peakMemory = (bytes: number, extra: Partial<Metric> = {}): Metric =>
  memory(bytes, { tolerance: PEAK_TOLERANCE, ...extra });

export const cpu = (pct: number, extra: Partial<Metric> = {}): Metric => ({
  value: pct,
  unit: "%",
  kind: "cpu",
  better: "lower",
  ...extra,
});
export const latency = (ms: number, extra: Partial<Metric> = {}): Metric => ({
  value: ms,
  unit: "ms",
  kind: "latency",
  better: "lower",
  ...extra,
});
export const time = (ms: number, extra: Partial<Metric> = {}): Metric => ({
  value: ms,
  unit: "ms",
  kind: "time",
  better: "lower",
  ...extra,
});
export const throughput = (
  perSecond: number,
  unit: string,
  extra: Partial<Metric> = {}
): Metric => ({
  value: perSecond,
  unit,
  kind: "throughput",
  better: "higher",
  ...extra,
});
export const count = (n: number, unit: string, extra: Partial<Metric> = {}): Metric => ({
  value: n,
  unit,
  kind: "count",
  better: "lower",
  ...extra,
});
