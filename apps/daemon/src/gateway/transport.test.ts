/**
 * The gateway carries the whole Wire: a 1 MiB blob offered by the Client
 * arrives whole and comes back whole, through binary WebSocket messages in
 * whatever pieces they arrive, and a text message ends the connection.
 */
import { expect, test } from "bun:test";
import { BlobId, makeWire, type Wire } from "@polaris/protocol";
import { Deferred, Effect, Schema, Stream } from "effect";
import { webSocketTransport } from "./client.testing.ts";
import { startGateway } from "./server.ts";
import { CLOSE_UNSUPPORTED_DATA, type GatewayTransport } from "./transport.ts";

const decodeEcho = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ blob: BlobId })));

test("blobs cross the gateway in both directions, in many WebSocket messages", async () => {
  const bytes = new Uint8Array(1024 * 1024).map((_, i) => i % 251);

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");

        // The server: every blob a peer announces comes back as a new blob.
        yield* gateway.connections.pipe(
          Stream.runForEach((transport) =>
            Effect.scoped(
              Effect.gen(function* () {
                transport.authenticated();
                const ready = yield* Deferred.make<Wire>();
                const scope = yield* Effect.scope;

                // Off the reader: a take inside `onJson` would wait for frames the reader holds.
                const onJson = (text: string) =>
                  Effect.gen(function* () {
                    const wire = yield* Deferred.await(ready);
                    const received = yield* wire.takeBlob(decodeEcho(text).blob);
                    const back = yield* wire.offerBlob(received);
                    yield* wire.sendJson(JSON.stringify({ blob: back }));
                  }).pipe(Effect.orDie, Effect.forkIn(scope), Effect.asVoid);

                const wire = yield* makeWire(transport, onJson, { blobIdPrefix: "d" });
                yield* Deferred.succeed(ready, wire);
                yield* Effect.ignore(wire.closed);
              })
            ).pipe(Effect.forkScoped)
          ),
          Effect.forkScoped
        );

        const transport = yield* webSocketTransport(gateway.url);
        const answer = yield* Deferred.make<BlobId>();

        const wire = yield* makeWire(
          transport,
          (text) => Deferred.succeed(answer, decodeEcho(text).blob),
          { blobIdPrefix: "c" }
        );

        const sent = yield* wire.offerBlob(bytes);
        yield* wire.sendJson(JSON.stringify({ blob: sent }));
        const returned = yield* wire.takeBlob(yield* Deferred.await(answer));

        return { same: Buffer.compare(returned, bytes) === 0, length: returned.byteLength };
      })
    )
  );

  expect(result).toEqual({ same: true, length: bytes.byteLength });
});

test("a text message closes the connection as unsupported data", async () => {
  const code = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        yield* gateway.connections.pipe(Stream.runDrain, Effect.forkScoped);

        return yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const socket = new WebSocket(gateway.url);
              socket.onopen = () => socket.send("hello as text");
              socket.onclose = (event) => resolve(event.code);
            })
        );
      })
    )
  );

  expect(code).toBe(CLOSE_UNSUPPORTED_DATA);
});

test("a peer cannot queue unbounded input while its consumer is stalled", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        // Accept transports without pulling their incoming streams.
        yield* gateway.connections.pipe(Stream.runDrain, Effect.forkScoped);

        const code = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const socket = new WebSocket(gateway.url);
              socket.onopen = () => {
                for (let i = 0; i < 80; i++) socket.send(new Uint8Array(1));
              };

              socket.onclose = (event) => resolve(event.code);
            })
        ).pipe(Effect.timeout("1 second"));

        expect(code).toBe(1009);
      })
    )
  ));

test.each([
  {
    who: "a peer with hostile close text",
    send: (socket: WebSocket) => socket.close(4001, "bye\n\u001b[31m" + "x".repeat(100)),
    expected: /^the peer closed it \(4001 bye  \[31mx{71}\) after hello/,
  },
  {
    who: "the peer",
    send: (socket: WebSocket) => socket.close(4001, "bye"),
    expected: /^the peer closed it \(4001 bye\) after hello, after [\d.]+ s, 0 bytes in, 0 out$/,
  },
  {
    who: "the Daemon",
    send: (socket: WebSocket) => socket.send("text"),
    expected: /^the Daemon closed it \(1003 binary frames only\) after hello/,
  },
])("a closed connection's summary says $who closed it, how, and when", ({ send, expected }) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        const accepted = yield* Deferred.make<GatewayTransport>();

        yield* gateway.connections.pipe(
          Stream.runForEach((transport) =>
            Effect.sync(() => transport.authenticated()).pipe(
              Effect.andThen(Deferred.succeed(accepted, transport)),
              Effect.andThen(transport.incoming.pipe(Stream.runDrain, Effect.ignore))
            )
          ),
          Effect.forkScoped
        );

        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              const socket = new WebSocket(gateway.url);

              socket.onopen = () => setTimeout(() => send(socket), 50);
              socket.onclose = () => resolve();
            })
        );
        const transport = yield* Deferred.await(accepted);

        yield* Effect.sleep("50 millis");
        expect(transport.summary()).toMatch(expected);
      })
    )
  )
);

test("a connection the Daemon ends by stopping says the Daemon closed it", async () => {
  const accepted = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        const first = yield* Deferred.make<GatewayTransport>();

        yield* gateway.connections.pipe(
          Stream.runForEach((transport) =>
            Effect.sync(() => transport.authenticated()).pipe(
              Effect.andThen(Deferred.succeed(first, transport)),
              Effect.andThen(transport.incoming.pipe(Stream.runDrain, Effect.ignore))
            )
          ),
          Effect.forkScoped
        );

        const socket = new WebSocket(gateway.url);

        yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));

        return yield* Deferred.await(first);
      })
    )
  );

  expect(accepted.summary()).toMatch(
    /^the Daemon closed it \(1001 the Daemon is stopping\) after hello/
  );
});
