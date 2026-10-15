import { EditPredictionRequest, PredictionError } from "@polaris/protocol";
import { Effect, Predicate, Schema, Stream } from "effect";
import { endpointDeltas, type PredictionFetch } from "../endpoint.ts";
import { countTokens } from "../budget.ts";
import { LatencyRecorder } from "../latency.ts";
import type { EditPredictor, PredictionOptions } from "../types.ts";
import { buildEditPrompt } from "./prompt.ts";

const endpointError = (cause: unknown): PredictionError =>
  Predicate.isTagged(cause, "PredictionError") && Schema.is(PredictionError)(cause)
    ? cause
    : new PredictionError({
        reason: "endpoint-failed",
        message: "Edit prediction endpoint failed or was canceled",
      });

const generate = async (
  request: EditPredictionRequest,
  options: PredictionOptions,
  cancel: AbortSignal,
  fetcher: PredictionFetch
) => {
  const controller = new AbortController();

  const signal = AbortSignal.any([
    cancel,
    controller.signal,
    ...(options.signal ? [options.signal] : []),
  ]);

  const start = performance.now();

  try {
    signal.throwIfAborted();
    const prompt = buildEditPrompt(request);

    if ((options.countTokens ?? countTokens)(prompt.prompt) > 32768)
      throw new PredictionError({
        reason: "invalid-request",
        message: "Edit prediction prompt exceeds the input limit",
      });
    options.onTiming?.("prompt", performance.now() - start);
    let output = "";

    for await (const delta of endpointDeltas(request, prompt, signal, fetcher)) {
      if (!output) options.onTiming?.("firstToken", performance.now() - start);
      output += delta;

      if (output.length > 65536)
        throw new PredictionError({
          reason: "invalid-response",
          message: "Edit prediction exceeds output limit",
        });

      if (prompt.stop.some((stop) => output.includes(stop))) break;
    }

    signal.throwIfAborted();
    const { editResult } = await import("./result.ts");
    signal.throwIfAborted();
    const result = editResult(request, output);

    return { ...result, elapsedMs: Math.max(0, performance.now() - start) };
  } finally {
    controller.abort();
  }
};

/** Create once per serving process; no request or timer starts before stream consumption. */
export const createEditPredictor = (fetcher: PredictionFetch = globalThis.fetch): EditPredictor => {
  const recorder = new LatencyRecorder();

  const predict = Effect.fnUntraced(function* (
    request: EditPredictionRequest,
    options: PredictionOptions
  ) {
    const input = yield* Schema.decodeUnknownEffect(EditPredictionRequest)(request).pipe(
      Effect.mapError(
        () =>
          new PredictionError({
            reason: "invalid-request",
            message: "Invalid edit prediction request",
          })
      )
    );

    const result = yield* Effect.tryPromise({
      try: (cancel) => generate(input, options, cancel, fetcher),
      catch: endpointError,
    });

    options.onTiming?.("final", result.elapsedMs);
    recorder.record(input.endpoint, result.elapsedMs);

    return result;
  });

  return {
    predict: (request, options = {}) => Stream.fromEffect(predict(request, options)),
    p50: (endpoint) => recorder.p50(endpoint),
  };
};
