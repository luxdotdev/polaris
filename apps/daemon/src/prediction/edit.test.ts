import { expect, test } from "bun:test";
import { EditPredictionItem, EditPredictionRequest, PredictionEdit } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { RpcGroup, RpcTest } from "effect/rpc";
import { editPredictionHandlers } from "./index.ts";

const request = EditPredictionRequest.make({
  context: [],
  path: "a.ts",
  buffer: "return 1;",
  cursor: 8,
  focus: null,
  history: [],
  model: "zeta-2.1",
  format: "zeta-2.1",
  endpoint: { kind: "openai", url: "http://fixture.invalid" },
  maxTokens: 128,
});

test("prediction.edit lazily streams exactly one Final over RPC without an EventStore", async () => {
  let loads = 0;

  const layer = editPredictionHandlers(async () => {
    loads++;

    return {
      p50: () => null,
      predict: (input) =>
        Stream.make(
          EditPredictionItem.cases.Final.make({
            edits: [{ from: input.cursor - 1, to: input.cursor, text: "2" }],
            cursor: input.cursor,
            window: { from: 0, to: input.buffer.length },
            suppressed: [],
            elapsedMs: 1,
          })
        ),
    };
  });

  const items = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(RpcGroup.make(PredictionEdit));
        expect(loads).toBe(0);

        return yield* Stream.runCollect(client["prediction.edit"](request));
      })
    ).pipe(Effect.provide(layer))
  );

  expect(loads).toBe(1);
  expect(items).toEqual([
    EditPredictionItem.cases.Final.make({
      edits: [{ from: 7, to: 8, text: "2" }],
      cursor: 8,
      window: { from: 0, to: 9 },
      suppressed: [],
      elapsedMs: 1,
    }),
  ]);
});

test("cancelling edit RPC consumption aborts the predictor HTTP signal", async () => {
  const started = Promise.withResolvers<AbortSignal | undefined>();

  const layer = editPredictionHandlers(async () => ({
    p50: () => null,
    predict: (_input, options) => {
      started.resolve(options?.signal);

      return Stream.never;
    },
  }));

  const controller = new AbortController();

  const pending = Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(RpcGroup.make(PredictionEdit));

        return yield* Stream.runCollect(client["prediction.edit"](request));
      })
    ).pipe(Effect.provide(layer)),
    { signal: controller.signal }
  );

  const signal = await started.promise;
  controller.abort();
  await pending;
  expect(signal?.aborted).toBe(true);
});

test("the production lazy edit RPC serves real predictor hunks from an HTTP endpoint", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response('data: {"choices":[{"text":"const count = 2;","finish_reason":"stop"}]}\n\n'),
  });

  try {
    const { PredictionRpcsLive } = await import("./index.ts");

    const items = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(RpcGroup.make(PredictionEdit));

          return yield* Stream.runCollect(
            client["prediction.edit"]({
              ...request,
              buffer: "const count = 1;",
              cursor: 15,
              model: "sweep-next-edit",
              format: "sweep-next-edit",
              endpoint: { kind: "openai", url: server.url.href },
            })
          );
        })
      ).pipe(Effect.provide(PredictionRpcsLive))
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.edits).toEqual([{ from: 14, to: 15, text: "2" }]);
  } finally {
    await server.stop(true);
  }
});
