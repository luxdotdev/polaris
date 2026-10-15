import type {
  EditPredictionItem,
  EditPredictionRequest,
  PredictionError,
  PredictionRequest,
  PredictionStreamItem,
} from "@polaris/protocol";
import type { Stream } from "effect";

/** Counts the text passed to it, including prompt markers; callers may supply a tokenizer. */

export type TokenCounter = (text: string) => number;

export interface PredictionOptions {
  readonly signal?: AbortSignal;
  readonly onTiming?: (stage: "prompt" | "firstToken" | "final", elapsedMs: number) => void;
  readonly countTokens?: TokenCounter;
}

export interface Predictor {
  readonly complete: (
    request: PredictionRequest,
    options?: PredictionOptions
  ) => Stream.Stream<PredictionStreamItem, PredictionError>;
  readonly p50: (endpoint: PredictionRequest["endpoint"]) => number | null;
}

/** Region-rewrite next-edit prediction (docs/specs/edit-prediction-v1.1.md §3). */
export interface EditPredictor {
  readonly predict: (
    request: EditPredictionRequest,
    options?: PredictionOptions
  ) => Stream.Stream<EditPredictionItem, PredictionError>;
  readonly p50: (endpoint: EditPredictionRequest["endpoint"]) => number | null;
}
