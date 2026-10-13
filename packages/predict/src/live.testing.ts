import { Effect, Predicate, Schema, Stream } from "effect";
import { PredictionStreamItem } from "@polaris/protocol";
import { createPredictor } from "./predictor.ts";
import { request } from "./fixtures.testing.ts";

/** Uses an existing user-run server; never starts, stops or downloads a model. */
export const livePrediction = async (url: string, model: string) => {
  const predictor = createPredictor();

  const input = {
    ...request,
    endpoint: { kind: request.endpoint.kind, url },
    model,
    path: "sum.py",
    prefix: "def add(a, b):\n    return ",
    suffix: "\n",
    maxTokens: 32,
  };

  const results = [];

  for (let run = 0; run < 2; run++) {
    const items = await Effect.runPromise(predictor.complete(input).pipe(Stream.runCollect));
    const final = items.find(Schema.is(PredictionStreamItem.cases.Final));

    if (!final || final.text.trim().length === 0)
      throw new Error("Live model did not return a nonempty final completion");
    results.push({
      text: final.text,
      elapsedMs: final.elapsedMs,
      deltas: items.filter(Predicate.isTagged("Delta")).length,
    });
  }

  return { results, p50Ms: predictor.p50(input.endpoint) };
};
