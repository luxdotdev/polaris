import { expect, test } from "bun:test";
import type { ByteTransport } from "@polaris/protocol";
import { Deferred, Effect, Exit, Fiber, Option, Stream } from "effect";
import { connectPairing, type OpenTransport } from "./connection.ts";
import type { ParsedPairing } from "./pairing.ts";
import { createPolarisWith } from "./promise.ts";
import { HostUnreachable } from "./errors.ts";

const pairing: ParsedPairing = {
  hostId: "test-host",
  hostName: "Test Host",
  url: null,
  token: "pol_ext_test",
  name: "Test",
};

test("cancelling hello releases the transport acquired by that connection", async () => {
  let released = 0;

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sent = yield* Deferred.make<void>();

        const openTransport: OpenTransport = () =>
          Effect.acquireRelease(
            Effect.succeed({
              incoming: Stream.never,
              write: () => Deferred.succeed(sent, undefined).pipe(Effect.asVoid),
              close: Effect.void,
            } satisfies ByteTransport),
            () => Effect.sync(() => released++)
          );

        const fiber = yield* connectPairing(pairing, {
          clientName: "test",
          clientVersion: "0",
          openTransport,
        }).pipe(Effect.forkScoped);

        yield* Deferred.await(sent);
        yield* Fiber.interrupt(fiber);

        return released;
      })
    )
  );

  expect(result).toBe(1);
});

test("the connection timeout also bounds opening the transport", async () => {
  const result = await Effect.runPromiseExit(
    connectPairing(pairing, {
      clientName: "test",
      clientVersion: "0",
      openTransport: () => Effect.never,
      helloTimeout: 10,
    }).pipe(Effect.timeout(1000))
  );

  expect(Option.getOrThrow(Exit.findErrorOption(result))).toBeInstanceOf(HostUnreachable);
});

test("closing the client cancels a pending hello and releases its transport", async () => {
  let released = 0;

  const sent = Effect.runSync(Deferred.make<void>());

  const client = await createPolarisWith({ pairings: [pairing], clientName: "test" }, () =>
    Effect.acquireRelease(
      Effect.succeed({
        incoming: Stream.never,
        write: () => Deferred.succeed(sent, undefined).pipe(Effect.asVoid),
        close: Effect.void,
      } satisfies ByteTransport),
      () => Effect.sync(() => released++)
    )
  );

  const connecting = client.connect(pairing.hostId).catch(() => undefined);

  await Effect.runPromise(Deferred.await(sent));
  await Effect.runPromise(Effect.promise(() => client.close()).pipe(Effect.timeout(1000)));
  await connecting;
  expect(released).toBe(1);
});
