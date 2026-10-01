import { describe, expect, test } from "bun:test";
import { type ByteTransport, makeWire, type TransportError } from "@polaris/protocol";
import {
  type Cause,
  Effect,
  Exit,
  Fiber,
  Predicate,
  Queue,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { RequestId, ResponseExitDieEncoded } from "effect/rpc/RpcMessage";
import { connectRpc } from "./rpc.ts";

/** The parts of a message from the Client that the peer looks at. */
const Sent = Schema.Struct({
  _tag: Schema.String,
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
});

const decodeSent = Schema.decodeUnknownSync(Schema.fromJsonString(Sent));

type Pipe = Queue.Queue<Uint8Array, TransportError | Cause.Done>;

/**
 * A Client connection to a silent peer: the peer's Wire records every message
 * the Client sends and answers only when told to.
 */
const silentPeer = Effect.gen(function* () {
  const toPeer: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();
  const toClient: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();

  const side = (inbox: Pipe, outbox: Pipe): ByteTransport => ({
    incoming: Stream.fromQueue(inbox),
    write: (bytes) => Effect.sync(() => Queue.offerUnsafe(outbox, bytes)),
    close: Effect.sync(() => Queue.endUnsafe(outbox)),
  });

  const received: Array<typeof Sent.Type> = [];

  const peer = yield* makeWire(side(toPeer, toClient), (text) =>
    Effect.sync(() => {
      received.push(decodeSent(text));
    })
  );

  const transport = { ...side(toClient, toPeer), diagnose: Effect.die("unused") };
  const connection = yield* connectRpc(transport, { pingIntervalMs: 20 });
  const pings = () => received.filter(Predicate.isTagged("Ping")).length;

  return { connection, peer, received, pings };
});

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

describe("keepalive", () => {
  test("a Client with only a subscription open sends no pings", async () => {
    const pings = await run(
      Effect.gen(function* () {
        const { connection, pings } = yield* silentPeer;
        yield* Stream.runDrain(connection.client.subscribeHost({ afterSequence: null })).pipe(
          Effect.forkScoped
        );
        yield* Effect.sleep(150);

        return pings();
      })
    );

    expect(pings).toBe(0);
  });

  test("pings while a reply is due, stop once it came, and a silent peer is lost", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { connection, peer, received, pings } = yield* silentPeer;

        const hello = yield* connection.client
          .hello({ clientName: "t", clientVersion: "0", deviceLabel: "t", capabilities: [] })
          .pipe(Effect.exit, Effect.forkScoped);

        // Wait for the first ping (due 20 ms after the request) rather than a fixed delay.
        for (let waited = 0; pings() === 0 && waited < 1000; waited += 10) {
          yield* Effect.sleep(10);
        }

        const whileWaiting = pings();
        // Answer the hello with a failure Exit: the reply is no longer due.
        const request: typeof Sent.Type = received.find((m) => Predicate.isTagged(m, "Request"))!;
        yield* peer.sendJson(
          JSON.stringify(
            ResponseExitDieEncoded({ requestId: RequestId(request.id!), encodedDefect: "no" })
          )
        );
        yield* Fiber.join(hello);
        const afterReply = pings();
        yield* Effect.sleep(100);
        const later = pings();
        // A second request the peer never answers: lost after 3 silent intervals.
        yield* connection.client
          .hello({ clientName: "t", clientVersion: "0", deviceLabel: "t", capabilities: [] })
          .pipe(Effect.forkScoped);
        const lost = yield* connection.lost.pipe(Effect.exit, Effect.timeout(1000));

        return { whileWaiting, afterReply, later, lost };
      })
    );

    expect(result.whileWaiting).toBeGreaterThan(0);
    expect(result.later).toBe(result.afterReply);
    expect(Exit.isFailure(result.lost)).toBe(true);
  });

  test("a late wake of the Client's own timer pings before declaring the peer lost", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { connection, received, pings } = yield* silentPeer;

        yield* connection.client
          .hello({ clientName: "t", clientVersion: "0", deviceLabel: "t", capabilities: [] })
          .pipe(Effect.forkScoped);

        while (!received.some((m) => Predicate.isTagged(m, "Request"))) {
          yield* Effect.sleep(1);
        }

        // Block the thread for 5 intervals, as a starved runner or a sleeping Mac does.
        Bun.sleepSync(100);
        const lost = yield* connection.lost.pipe(Effect.exit, Effect.timeout(1000));

        return { pingsBeforeLost: pings(), lost };
      })
    );

    expect(result.pingsBeforeLost).toBeGreaterThan(0);
    expect(Exit.isFailure(result.lost)).toBe(true);
  });
});
