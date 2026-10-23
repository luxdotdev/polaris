import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Queue, Stream } from "effect";
import { encodeBlobFrame, encodeJsonFrame } from "./frame.ts";
import { makeWire } from "./wire.ts";

test.each(["complete", "receiving", "aborted"] as const)(
  "a flood of zero-byte %s blobs closes at the metadata limit",
  async (kind) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let closed = false;

          const wire = yield* makeWire(
            {
              incoming: Stream.fromIterable(
                Array.from({ length: 1000 }, (_, i) =>
                  encodeBlobFrame(
                    String(i),
                    new Uint8Array(),
                    kind === "complete",
                    kind === "aborted"
                  )
                )
              ),
              write: () => Effect.void,
              close: Effect.sync(() => {
                closed = true;
              }),
            },
            () => Effect.void,
            { maxIncomingBlobs: 8 }
          );

          const result = yield* Effect.flip(wire.closed);
          expect(result.message).toBe("incoming blob count limit exceeded");
          expect(closed).toBe(true);
          expect(wire.stats().incomingBlobs).toBe(0);
          expect(wire.stats().bufferedBlobBytes).toBe(0);
          expect((yield* Effect.flip(wire.takeBlob("after-close"))).reason).toBe("closed");
          expect(wire.stats().incomingBlobs).toBe(0);
        })
      )
    );
  }
);

test("pending takes share the count cap and consuming a blob frees capacity", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const incoming = yield* Queue.unbounded<Uint8Array>();
        const received = yield* Deferred.make<void>();

        const wire = yield* makeWire(
          {
            incoming: Stream.fromQueue(incoming),
            write: () => Effect.void,
            close: Effect.void,
          },
          () => Deferred.succeed(received, undefined).pipe(Effect.asVoid),
          { maxIncomingBlobs: 1 }
        );

        const waiting = yield* Effect.forkChild(wire.takeBlob("first"));
        yield* Effect.yieldNow;
        expect((yield* Effect.flip(wire.takeBlob("second"))).reason).toBe("too-large");
        expect((yield* Effect.flip(Stream.runDrain(wire.takeBlobStream("third")))).reason).toBe(
          "too-large"
        );
        yield* Queue.offer(incoming, encodeBlobFrame("first", new Uint8Array([7]), true));
        expect(yield* Fiber.join(waiting)).toEqual(new Uint8Array([7]));
        yield* Queue.offer(incoming, encodeBlobFrame("second", new Uint8Array(), true));
        yield* Queue.offer(incoming, encodeJsonFrame("barrier"));
        yield* Deferred.await(received);
        expect(yield* wire.takeBlob("second")).toEqual(new Uint8Array());
        expect(wire.stats().incomingBlobs).toBe(0);
      })
    )
  );
});

test("expiry frees unclaimed metadata capacity", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const incoming = yield* Queue.unbounded<Uint8Array>();
        const received = yield* Queue.unbounded<void>();

        const wire = yield* makeWire(
          {
            incoming: Stream.fromQueue(incoming),
            write: () => Effect.void,
            close: Effect.void,
          },
          () => Queue.offer(received, undefined).pipe(Effect.asVoid),
          {
            maxIncomingBlobs: 1,
            unclaimedBlobTtlMs: 1,
            blobIdleTimeoutMs: 100,
          }
        );

        yield* Queue.offer(incoming, encodeBlobFrame("expired", new Uint8Array([1]), true));
        yield* Queue.offer(incoming, encodeJsonFrame("barrier"));
        yield* Queue.take(received);
        yield* Effect.sleep(100);
        yield* Queue.offer(incoming, encodeBlobFrame("fresh", new Uint8Array([2]), true));
        yield* Queue.offer(incoming, encodeJsonFrame("barrier"));
        yield* Queue.take(received);
        expect(yield* wire.takeBlob("fresh")).toEqual(new Uint8Array([2]));
        expect(wire.stats().incomingBlobs).toBe(0);
      })
    )
  );
});
