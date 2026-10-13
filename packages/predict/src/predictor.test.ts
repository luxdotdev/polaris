import { expect, test } from "bun:test";
import { Effect, Fiber, Result, Schema, Stream } from "effect";
import { PredictionStreamItem } from "@polaris/protocol";
import { createPredictor } from "./predictor.ts";
import { fixtureFetch, request, sse } from "./fixtures.testing.ts";
import type { PredictionFetch } from "./endpoint.ts";

const collect = (predictor: ReturnType<typeof createPredictor>, input = request) =>
  Effect.runPromise(predictor.complete(input).pipe(Stream.runCollect));

test("SSE chunks survive every byte boundary, unicode, comments, and suffix overlap", async () => {
  const predictor = createPredictor(fixtureFetch(`: ping\r\n\r\n${sse("a + b /* café 😀 */;\n")}`));
  const items = await collect(predictor);
  expect(items).toHaveLength(2);
  expect(items[1]).toMatchObject({ text: "a + b /* café 😀 */" });
  expect(Schema.is(PredictionStreamItem.cases.Final)(items[1])).toBe(true);
  expect(predictor.p50(request.endpoint)).toBeGreaterThanOrEqual(0);
});

test("Ollama sends raw prompt and handles content in final NDJSON record", async () => {
  let payload = "";
  let url = "";

  const fetcher: PredictionFetch = async (address, init) => {
    url = address;
    payload = Schema.decodeUnknownSync(Schema.String)(init.body);

    return fixtureFetch('{"response":"a + ","done":false}\n{"response":"b;\\n","done":true}')(
      address,
      init
    );
  };

  const items = await collect(createPredictor(fetcher), {
    ...request,
    endpoint: { kind: "ollama", url: "http://localhost:11434" },
  });

  expect(url).toBe("http://localhost:11434/api/generate");
  expect(JSON.parse(payload)).toMatchObject({
    raw: true,
    stream: true,
    options: { num_predict: 64 },
  });
  expect(items.at(-1)).toMatchObject({ text: "a + b" });
});

test("OpenAI suffix form uses a separate suffix and /v1 only once", async () => {
  const fetcher: PredictionFetch = async (url, init) => {
    expect(url).toBe("http://localhost:1234/v1/completions");
    expect(JSON.parse(Schema.decodeUnknownSync(Schema.String)(init.body))).toMatchObject({
      prompt: request.prefix,
      suffix: request.suffix,
    });

    return fixtureFetch(sse("a+b"))(url, init);
  };

  await collect(createPredictor(fetcher), {
    ...request,
    format: "suffix",
    endpoint: { kind: "openai", url: "http://localhost:1234/v1/" },
  });
});

test("truncated, malformed and HTTP error streams fail without recording latency", async () => {
  for (const fetcher of [
    fixtureFetch(sse("partial", false)),
    fixtureFetch("data: nope\n\n"),
    fixtureFetch('data: {"error":"failure"}\n\n'),
    async () => new Response("oops", { status: 503 }),
  ]) {
    const predictor = createPredictor(fetcher);
    expect(
      Result.isFailure(
        await Effect.runPromise(predictor.complete(request).pipe(Stream.runCollect, Effect.result))
      )
    ).toBe(true);
    expect(predictor.p50(request.endpoint)).toBeNull();
  }
});

test("pre-abort issues no HTTP request", async () => {
  let calls = 0;

  const predictor = createPredictor(async () => {
    calls++;

    return new Response();
  });

  expect(
    Result.isFailure(
      await Effect.runPromise(
        predictor
          .complete(request, { signal: AbortSignal.abort() })
          .pipe(Stream.runCollect, Effect.result)
      )
    )
  ).toBe(true);
  expect(calls).toBe(0);
});

test("consumer interruption aborts a pending HTTP request", async () => {
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();

  const fetcher: PredictionFetch = async (_, init) =>
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
    });

  const fiber = Effect.runFork(createPredictor(fetcher).complete(request).pipe(Stream.runCollect));
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  await aborted.promise;
});

test("ending consumption cancels the response body and suppresses Final", async () => {
  let canceled = false;

  const fetcher: PredictionFetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse("partial", false)));
        },
        cancel() {
          canceled = true;
        },
      })
    );

  const items = await Effect.runPromise(
    createPredictor(fetcher).complete(request).pipe(Stream.take(1), Stream.runCollect)
  );

  expect(items).toHaveLength(1);
  // Allow the aborted read's cleanup to settle after the consumer scope closes.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(canceled).toBe(true);
});

test("recorded Mellum2 SSE replays through the complete predictor", async () => {
  const recorded = await Bun.file(new URL("./fixtures/mellum-sum.sse", import.meta.url)).text();

  const items = await collect(createPredictor(fixtureFetch(recorded)), {
    ...request,
    suffix: "\n",
  });

  expect(items.at(-1)).toMatchObject({ text: "a + b" });
  expect(items).toHaveLength(4);
});
