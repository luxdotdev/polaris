import { expect, test } from "bun:test";
import { Effect, Fiber, Result, Schema, Stream } from "effect";
import { createEditPredictor } from "./index.ts";
import { request, fixtures, fixtureRequest } from "./fixtures.testing.ts";
import { fixtureFetch, sse } from "../fixtures.testing.ts";
import { applyEdits } from "./guards.ts";
import type { PredictionFetch } from "../endpoint.ts";

const collect = (predictor: ReturnType<typeof createEditPredictor>, input = request) =>
  Effect.runPromise(predictor.predict(input).pipe(Stream.runCollect));

const output = "<|marker_1|>const value = 2;\n\n<|marker_2|>";

test("OpenAI streaming emits one Final through byte-split Unicode records and records p50", async () => {
  const input = { ...request, buffer: "const value = '😀';", cursor: 15 };
  const events: string[] = [];

  const predictor = createEditPredictor(
    fixtureFetch(sse("<|marker_1|>const value = '😃';\n<|marker_2|>"))
  );

  expect(predictor.p50(input.endpoint)).toBeNull();

  const items = await Effect.runPromise(
    predictor.predict(input, { onTiming: (event) => events.push(event) }).pipe(Stream.runCollect)
  );

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ edits: [{ from: 15, to: 17, text: "😃" }], cursor: 17 });
  expect(predictor.p50(input.endpoint)).toBe(items[0]?.elapsedMs ?? -1);
  expect(events).toEqual(["prompt", "firstToken", "final"]);
});

test("both formats traverse the full endpoint pipeline with their greedy cacheable prompts", async () => {
  const fixture = fixtures.find((item) => item.id === "in02")!;

  for (const recorded of fixture.outputs) {
    const input = fixtureRequest(fixture, recorded.format);

    const fetcher: PredictionFetch = async (url, init) => {
      expect(url).toBe("http://127.0.0.1:9999/v1/completions");
      expect(JSON.parse(Schema.decodeUnknownSync(Schema.String)(init.body))).toMatchObject({
        model: "test",
        temperature: 0,
        max_tokens: 512,
        cache_prompt: true,
        stream: true,
      });
      expect(init).toMatchObject({ redirect: "error", credentials: "omit" });

      return fixtureFetch(sse(recorded.output))(url, init);
    };

    const result = await collect(createEditPredictor(fetcher), input);
    expect(result).toHaveLength(1);
    expect(applyEdits(input.buffer, result[0]?.edits ?? [])).toBe(
      applyEdits(input.buffer, fixture.expected)
    );
  }
});

test("Ollama uses raw NDJSON generation with content in its done record", async () => {
  const fetcher: PredictionFetch = async (url, init) => {
    expect(url).toBe("http://localhost:11434/api/generate");
    expect(JSON.parse(Schema.decodeUnknownSync(Schema.String)(init.body))).toMatchObject({
      raw: true,
      stream: true,
      options: { temperature: 0, num_predict: 512, stop: ["<[end▁of▁sentence]>", "<[fim-"] },
    });

    return fixtureFetch(JSON.stringify({ response: output, done: true }))(url, init);
  };

  const result = await collect(createEditPredictor(fetcher), {
    ...request,
    endpoint: { kind: "ollama", url: "http://localhost:11434" },
  });

  expect(result).toHaveLength(1);
  expect(result[0]?.edits).toEqual([{ from: 14, to: 15, text: "2" }]);
});

test("malformed, truncated, oversized and failed generation produces no Final or latency", async () => {
  const fetchers = [
    fixtureFetch("data: nope\n\n"),
    fixtureFetch(sse(output, false)),
    fixtureFetch(sse("<|marker_1|>unfinished")),
    fixtureFetch(sse("x".repeat(65537), false), 8192),
    fixtureFetch(
      `data: ${JSON.stringify({ choices: [{ text: output, finish_reason: "length" }] })}\n\n`
    ),
    async () => new Response("unavailable", { status: 503 }),
  ];

  for (const fetcher of fetchers) {
    const predictor = createEditPredictor(fetcher);

    const result = await Effect.runPromise(
      predictor.predict(request).pipe(Stream.runCollect, Effect.result)
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(predictor.p50(request.endpoint)).toBeNull();
  }
});

test("invalid input and pre-abort never dispatch HTTP", async () => {
  let calls = 0;

  const predictor = createEditPredictor(async () => {
    calls++;

    return new Response();
  });

  for (const input of [
    { ...request, cursor: -1 },
    { ...request, focus: request.buffer.length + 1 },
    { ...request, buffer: "x".repeat(40000) },
  ]) {
    const result = await Effect.runPromise(
      predictor.predict(input).pipe(Stream.runCollect, Effect.result)
    );

    expect(Result.isFailure(result)).toBe(true);
  }

  const aborted = await Effect.runPromise(
    predictor
      .predict(request, { signal: AbortSignal.abort() })
      .pipe(Stream.runCollect, Effect.result)
  );

  expect(Result.isFailure(aborted)).toBe(true);
  expect(calls).toBe(0);
});

test("signal abort cancels a pending response body without Final or latency", async () => {
  const started = Promise.withResolvers<void>();
  const canceled = Promise.withResolvers<void>();
  const controller = new AbortController();

  const fetcher: PredictionFetch = async () =>
    new Response(
      new ReadableStream({
        start(body) {
          body.enqueue(new TextEncoder().encode(sse("<|marker_1|>", false)));
          started.resolve();
        },
        cancel() {
          canceled.resolve();
        },
      })
    );

  const predictor = createEditPredictor(fetcher);

  const pending = Effect.runPromise(
    predictor.predict(request, { signal: controller.signal }).pipe(Stream.runCollect, Effect.result)
  );

  await started.promise;
  controller.abort();
  expect(Result.isFailure(await pending)).toBe(true);
  await canceled.promise;
  expect(predictor.p50(request.endpoint)).toBeNull();
});

test("consumer interruption aborts the in-flight HTTP fetch", async () => {
  const started = Promise.withResolvers<void>(),
    aborted = Promise.withResolvers<void>();

  const predictor = createEditPredictor(
    async (_, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            reject(new Error("aborted"));
          },
          { once: true }
        );
        started.resolve();
      })
  );

  const fiber = Effect.runFork(predictor.predict(request).pipe(Stream.runCollect));
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  await aborted.promise;
  expect(predictor.p50(request.endpoint)).toBeNull();
});
