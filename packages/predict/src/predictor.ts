import { PredictionError, PredictionRequest, PredictionStreamItem } from "@polaris/protocol";
import { Effect, Predicate, Queue, Schema, Stream } from "effect";
import { endpointDeltas, type PredictionFetch } from "./endpoint.ts";
import { generationBudget } from "./generation.ts";
import { LatencyRecorder } from "./latency.ts";
import { postprocess } from "./postprocess.ts";
import { buildPrompt } from "./prompt.ts";
import type { PredictionOptions, Predictor } from "./types.ts";

const endpointError = (cause: unknown): PredictionError =>
  Predicate.isTagged(cause, "PredictionError") && Schema.is(PredictionError)(cause)
    ? cause
    : new PredictionError({
        reason: "endpoint-failed",
        message: "Completion endpoint request failed or was canceled",
      });

const generate = (
  request: PredictionRequest,
  options: PredictionOptions,
  recorder: LatencyRecorder,
  fetcher: PredictionFetch
) =>
  Stream.callback<PredictionStreamItem, PredictionError>((queue) =>
    Effect.gen(function* () {
      const run = Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(PredictionRequest)(request).pipe(
          Effect.mapError(
            () =>
              new PredictionError({
                reason: "invalid-request",
                message: "Invalid prediction request",
              })
          )
        );

        yield* Effect.tryPromise({
          try: async (cancel) => {
            const controller = new AbortController();

            const signal = AbortSignal.any([
              cancel,
              controller.signal,
              ...(options.signal ? [options.signal] : []),
            ]);

            const start = performance.now();
            let text = "";

            try {
              signal.throwIfAborted();
              const budget = generationBudget(input.prefix, input.maxTokens, input.maxLines);
              const built = buildPrompt(input, options.countTokens);

              const prompt = {
                ...built,
                stop: budget.singleLine ? [...built.stop, "\n"] : built.stop,
              };

              options.onTiming?.("prompt", performance.now() - start);

              for await (const delta of endpointDeltas(
                { ...input, maxTokens: budget.maxTokens },
                prompt,
                signal,
                fetcher
              )) {
                if (!text) options.onTiming?.("firstToken", performance.now() - start);
                text += delta;

                if (text.length > 65536)
                  throw new PredictionError({
                    reason: "invalid-response",
                    message: "Completion exceeds output limit",
                  });
                Queue.offerUnsafe(queue, PredictionStreamItem.cases.Delta.make({ text: delta }));

                if (
                  prompt.stop.some((marker) => text.includes(marker)) ||
                  text.split("\n").length > budget.maxLines
                )
                  break;
              }

              signal.throwIfAborted();
              const elapsedMs = Math.max(0, performance.now() - start);
              recorder.record(input.endpoint, elapsedMs);
              options.onTiming?.("final", elapsedMs);
              Queue.offerUnsafe(
                queue,
                PredictionStreamItem.cases.Final.make({
                  text: postprocess(text, input.suffix, prompt.stop, budget.maxLines),
                  elapsedMs,
                })
              );
            } finally {
              controller.abort();
            }
          },
          catch: endpointError,
        });
      }).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => Queue.failCause(queue, cause),
          onSuccess: () => Queue.end(queue),
        })
      );

      yield* Effect.forkScoped(run);
    })
  );

/** Create once per serving process; each subscription starts its own cancellable request. */
export const createPredictor = (fetcher: PredictionFetch = globalThis.fetch): Predictor => {
  const recorder = new LatencyRecorder();

  return {
    complete: (request, options = {}) => generate(request, options, recorder, fetcher),
    p50: (endpoint) => recorder.p50(endpoint),
  };
};
