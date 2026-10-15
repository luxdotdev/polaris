/**
 * Forwards the outcome log to main (`main/prediction/README.md`): one `prediction.outcome` per
 * finalized record and keystroke deltas merged into one `prediction.keystrokes`, flushed once per
 * microtask in emission order. Stopping flushes what is queued.
 */
import type { PolarisApi } from "../../../../../shared/api.ts";
import { onPredictionLog, type PredictionLogRecord } from "./outcomes.ts";

export type PredictionNotify = NonNullable<PolarisApi["notify"]>;

const send = (notify: PredictionNotify, records: ReadonlyArray<PredictionLogRecord>) => {
  let keystrokes = 0;

  for (const record of records) {
    if ("keystrokes" in record) {
      keystrokes += record.keystrokes;
      continue;
    }

    if (keystrokes > 0) notify("prediction.keystrokes", { keystrokes });
    keystrokes = 0;
    notify("prediction.outcome", record);
  }

  if (keystrokes > 0) notify("prediction.keystrokes", { keystrokes });
};

/** `notify` is read at each flush: an older preload without it drops the records. */
export const forwardPredictionLog = (notify: () => PredictionNotify | undefined): (() => void) => {
  let queue: PredictionLogRecord[] = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const records = queue;
    queue = [];
    const target = notify();

    if (target !== undefined && records.length > 0) send(target, records);
  };

  const stop = onPredictionLog((record) => {
    queue.push(record);

    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  });

  return () => {
    stop();
    flush();
  };
};
