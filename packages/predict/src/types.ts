import type { PredictionError, PredictionRequest, PredictionStreamItem } from "@polaris/protocol";
import type { Stream } from "effect";

/** Counts the text passed to it, including prompt markers; callers may supply a tokenizer. */

export type TokenCounter = (text: string) => number;

export interface PredictionOptions {
  readonly signal?: AbortSignal;
  readonly countTokens?: TokenCounter;
}

export interface Predictor {
  readonly complete: (
    request: PredictionRequest,
    options?: PredictionOptions
  ) => Stream.Stream<PredictionStreamItem, PredictionError>;
  readonly p50: (endpoint: PredictionRequest["endpoint"]) => number | null;
}
