/**
 * The one emitter behind the local outcome log (docs/specs/edit-prediction-v1.1.md §8,
 * `main/prediction/README.md`): finalized `PredictionOutcome` records and keystroke deltas, as
 * `PredictionLogRecord`. `forward.ts` sends them to main over `prediction.outcome` and
 * `prediction.keystrokes`; nothing here holds source text, paths or identifiers.
 */
import type {
  PredictionLogRecord,
  PredictionOutcome,
} from "../../../../../shared/predictionOutcomes.ts";

export type { PredictionLogRecord, PredictionOutcome };

export const UNDO_WINDOW_MS = 30_000;

type Listener = (record: PredictionLogRecord) => void;

const listeners = new Set<Listener>();

let pendingKeystrokes = 0;

/** Subscribes the outcome log; returns the unsubscribe. */
export const onPredictionLog = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const emit = (record: PredictionLogRecord) => {
  for (const listener of listeners) listener(record);
};

/** Sends the keystrokes typed since the last record, if any. */
export const flushKeystrokes = () => {
  if (pendingKeystrokes === 0) return;
  const keystrokes = pendingKeystrokes;
  pendingKeystrokes = 0;
  emit({ keystrokes });
};

/** One document-input keystroke; flushed with the next outcome or on Editor disposal. */
export const countKeystroke = () => {
  pendingKeystrokes += 1;
};

export const emitPredictionOutcome = (record: PredictionOutcome) => {
  flushKeystrokes();
  emit(record);
};
