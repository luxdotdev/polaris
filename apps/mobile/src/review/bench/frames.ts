/** Frame-interval statistics for the diff bench: percentiles and frames past 1.5× the budget. */
export interface FrameStats {
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** The display's frame interval, in ms. */
  readonly budget: number;
  /** Intervals longer than 1.5 × `budget`: a frame the display showed twice. */
  readonly dropped: number;
}

const percentile = (sorted: ReadonlyArray<number>, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;

const round = (ms: number) => Math.round(ms * 100) / 100;

export const frameStats = (intervals: ReadonlyArray<number>, budget: number): FrameStats => {
  const sorted = [...intervals].sort((a, b) => a - b);

  return {
    frames: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? 0),
    budget: round(budget),
    dropped: sorted.filter((ms) => ms > budget * 1.5).length,
  };
};

/** The display's interval from idle frames: their median, so one hiccup doesn't move it. */
export const displayBudget = (idle: ReadonlyArray<number>): number =>
  percentile(
    [...idle].sort((a, b) => a - b),
    0.5
  );

export const statsLine = (label: string, s: FrameStats): string =>
  `${label}: p50 ${s.p50} · p95 ${s.p95} · p99 ${s.p99} · max ${s.max} ms · ${s.dropped}/${s.frames} over 1.5× ${s.budget} ms`;
