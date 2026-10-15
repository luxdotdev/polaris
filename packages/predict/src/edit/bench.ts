import { Effect, Stream } from "effect";
import { buildPrompt } from "../prompt.ts";
import { request as fimRequest, fixtureFetch, sse } from "../fixtures.testing.ts";
import { fixtures, fixtureRequest } from "./fixtures.testing.ts";
import { createEditPredictor } from "./index.ts";

const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);

  return {
    p50Ms: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
  };
};

const fim = {
  ...fimRequest,
  prefix: Array.from({ length: 300 }, (_, i) => `const item${i} = ${i};`).join("\n"),
};

for (let round = 1; round <= 3; round++) {
  const prompt: number[] = [],
    replay: number[] = [];

  for (let i = 0; i < 1000; i++) {
    const start = performance.now();
    buildPrompt(fim);
    prompt.push(performance.now() - start);
  }

  for (const fixture of fixtures)
    for (const recorded of fixture.outputs) {
      const predictor = createEditPredictor(fixtureFetch(sse(recorded.output), 256));
      const start = performance.now();
      await Effect.runPromise(
        predictor.predict(fixtureRequest(fixture, recorded.format)).pipe(Stream.runDrain)
      );
      replay.push(performance.now() - start);
    }

  console.log(
    JSON.stringify({
      round,
      fimPrompt: stats(prompt),
      replayPipeline: stats(replay),
      boundary: "in-memory HTTP; no model server",
    })
  );
}
