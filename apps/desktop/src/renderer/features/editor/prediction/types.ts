import type { EditorView } from "@codemirror/view";

/** A future same-buffer import edit, fenced against the text used to predict it. */
export interface AdditionalEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly expected: string;
}

export interface Prediction {
  readonly text: string;
  readonly additionalEdits?: ReadonlyArray<AdditionalEdit>;
}

export interface PredictionInput {
  readonly buffer: string;
  readonly cursor: number;
}

export interface PredictionPort {
  readonly allowed: (view: EditorView) => boolean;
  readonly request: (input: PredictionInput, signal: AbortSignal) => Promise<Prediction>;
  readonly subscribe: (refresh: () => void) => () => void;
}
