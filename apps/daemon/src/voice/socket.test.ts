import { expect, test } from "bun:test";
import { Effect, Fiber, Stream } from "effect";
import { pump } from "./socket.ts";

test("audio waits for WebSocket backpressure and splits a large chunk before sending", async () => {
  const sent: Array<string | Uint8Array> = [];

  const socket = {
    readyState: Number(WebSocket.OPEN),
    bufferedAmount: 128 * 1024,
    send: (data: string | Uint8Array) => {
      sent.push(data);
    },
  };

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* pump(socket, Stream.make(new Uint8Array(100_000))).pipe(
          Effect.forkScoped
        );

        yield* Effect.sleep("30 millis");
        expect(sent).toEqual([]);
        socket.bufferedAmount = 0;
        yield* Fiber.join(writer);
      })
    )
  );

  const audio = sent.filter((part) => part instanceof Uint8Array);
  expect(audio.map((part) => part.byteLength)).toEqual([32_000, 32_000, 32_000, 4000]);
  expect(sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
});

test("a socket that closes during backpressure fails instead of dropping audio", async () => {
  const socket = {
    readyState: Number(WebSocket.OPEN),
    bufferedAmount: 128 * 1024,
    send: () => {},
  };

  const exit = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const writer = yield* pump(socket, Stream.make(new Uint8Array(2))).pipe(Effect.forkScoped);
        yield* Effect.sleep("20 millis");
        socket.readyState = WebSocket.CLOSED;

        return yield* Fiber.await(writer);
      })
    )
  );

  expect(JSON.stringify(exit)).toContain('"reason":"provider-failed"');
});
