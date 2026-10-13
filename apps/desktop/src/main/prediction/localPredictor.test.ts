import { expect, test } from "bun:test";
import { PredictionRequest } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { LocalPredictor } from "./localPredictor.ts";

test("LocalPredictor streams through the shared predictor and retains endpoint latency", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response('data: {"choices":[{"text":"42","finish_reason":"stop"}]}\n\n'),
  });

  const request = PredictionRequest.make({
    context: [],
    path: "a.ts",
    prefix: "const a = ",
    suffix: ";",
    model: "fixture",
    format: "mellum-spm",
    endpoint: { kind: "openai", url: server.url.href },
    budgetTokens: 512,
    maxTokens: 32,
    maxLines: 3,
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const predictor = yield* LocalPredictor;
        expect(predictor.p50(request.endpoint)).toBeNull();
        const result = yield* predictor.complete(request).pipe(Stream.runCollect);
        expect(result.at(-1)).toMatchObject({ text: "42" });
        expect(predictor.p50(request.endpoint)).toBeGreaterThanOrEqual(0);
      }).pipe(Effect.provide(LocalPredictor.layer))
    );
  } finally {
    await server.stop(true);
  }
});
