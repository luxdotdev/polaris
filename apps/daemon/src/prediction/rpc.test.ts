import { expect, test } from "bun:test";
import { PredictionComplete, PredictionRequest } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { RpcGroup, RpcTest } from "effect/rpc";
import { fileURLToPath } from "node:url";
import { PredictionRpcsLive } from "./index.ts";

const request = (url: string) =>
  PredictionRequest.make({
    context: [],
    path: "a.ts",
    prefix: "const a = ",
    suffix: ";\n",
    model: "fixture",
    format: "mellum-spm",
    endpoint: { kind: "openai", url },
    budgetTokens: 512,
    maxTokens: 32,
    maxLines: 3,
  });

test("prediction.complete streams and finalizes over RPC without an EventStore", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        'data: {"choices":[{"text":"42;\\n","finish_reason":null}]}\n\ndata: [DONE]\n\n'
      ),
  });

  try {
    const items = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(RpcGroup.make(PredictionComplete));

          return yield* rpc["prediction.complete"](request(server.url.href)).pipe(
            Stream.runCollect
          );
        })
      ).pipe(Effect.provide(PredictionRpcsLive))
    );

    expect(items.at(-1)).toMatchObject({ text: "42" });
  } finally {
    await server.stop(true);
  }
});

test("RPC cancellation aborts the Host HTTP stream", async () => {
  const disconnected = Promise.withResolvers<void>();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      req.signal.addEventListener("abort", () => disconnected.resolve(), { once: true });

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"text":"42","finish_reason":null}]}\n\n')
            );
          },
          cancel() {
            disconnected.resolve();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      );
    },
  });

  try {
    const items = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(RpcGroup.make(PredictionComplete));

          return yield* rpc["prediction.complete"](request(server.url.href)).pipe(
            Stream.take(1),
            Stream.runCollect
          );
        })
      ).pipe(Effect.provide(PredictionRpcsLive))
    );

    expect(items).toHaveLength(1);
    await disconnected.promise;
  } finally {
    await server.stop(true);
  }
}, 5000);

test("Daemon startup does not import the predictor implementation", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `await import(${JSON.stringify(fileURLToPath(new URL("../transport/serve.ts", import.meta.url)))}); console.log(Object.keys(require.cache).map(path => path.replaceAll("\\\\", "/")).filter(path => path.includes('/packages/predict/src/') || path.endsWith('/daemon/src/prediction/complete.ts') || path.endsWith('/daemon/src/prediction/edit.ts')).length);`,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output.trim()).toBe("0");
});
