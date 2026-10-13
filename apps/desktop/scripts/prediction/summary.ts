import { Schema } from "effect";

const Mark = Schema.Struct({
  name: Schema.String,
  startTime: Schema.Number,
  detail: Schema.NullOr(Schema.Record(Schema.String, Schema.Number)),
});

export const Snapshot = Schema.Struct({
  marks: Schema.Array(Mark),
  text: Schema.String,
  painted: Schema.Number,
});

export interface LatencySample {
  readonly fixture: number;
  readonly repeat: number;
  readonly key: string;
  readonly load: readonly number[];
  readonly snapshot: typeof Snapshot.Type;
}

const mark = (sample: LatencySample, stage: string) => {
  const value = sample.snapshot.marks.find((entry) => entry.name === `polaris.prediction.${stage}`);

  if (!value) throw new Error(`Missing ${stage} in fixture ${sample.fixture}`);

  return value.startTime;
};

const percentiles = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return {
    p50:
      sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
  };
};

/** Frame callbacks on hidden windows are throttled; only DOM marks define the timing gate. */
export const summarizeLatency = (samples: readonly LatencySample[]) => {
  const warm = samples.filter((sample) => sample.repeat > 0);

  return {
    samples: warm.length,
    ghostDomMs: percentiles(
      warm.map((sample) => mark(sample, "render") - mark(sample, "keystroke"))
    ),
    finalMs: percentiles(warm.map((sample) => mark(sample, "final") - mark(sample, "keystroke"))),
    load1: warm.map((sample) => sample.load[0]),
    measurement:
      "Real Electron keystroke to first ghost DOM insertion; warm fixed fixtures, not physical display timing.",
  };
};
