// Portions adapted from Effect-TS/effect, npm effect@4.0.0-rc.118 (MIT): src/rpc/RpcClient.ts `makeProtocolSocket`
/**
 * Runs an effect/rpc client for `DaemonRpcs` over one framed Wire.
 *
 * The `RpcClient.Protocol` mirrors effect/rpc's socket client protocol
 * (`makeProtocolSocket` in effect@4.0.0-rc.118 `RpcClient.ts`): requests are
 * routed back to the RpcClient that sent them, a lost connection fails every
 * in-flight request with an RpcClientError, and a ping loop detects a dead
 * peer. Unlike it, there is no built-in retry: a Wire is one connection, and
 * HostConnection owns reconnecting.
 *
 * Pings run only while a request is waiting for its reply. Streams (host and
 * session subscriptions, watches) don't count: a Client that is only
 * subscribed sends nothing, so an idle Daemon is never woken. Any JS the
 * Daemon runs, even answering a ping, keeps the Bun runtime waking ~10 times a
 * second for up to ~30 s afterwards, so a 15 s ping would keep it awake for
 * good. While only streams are open, a dead link is noticed by the transport
 * instead: the Unix socket closes, or ssh's own keepalives (answered by sshd,
 * never reaching the Daemon) end the session.
 */
import {
  type BlobError,
  type BlobId,
  type BlobSource,
  DaemonRpcs,
  makeWire,
  type TakeStreamOptions,
  type Wire,
  type WireOptions,
} from "@polaris/protocol";
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Latch,
  Option,
  Predicate,
  type Scope,
  type Stream,
} from "effect";
import { RpcClient, type RpcGroup, RpcSchema, RpcSerialization } from "effect/rpc";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import { constPing, type FromServerEncoded } from "effect/rpc/RpcMessage";
import type { ClientTransport } from "./transport.ts";

export type DaemonClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof DaemonRpcs>, RpcClientError>;

export interface ClientBlobs {
  /** Send bytes to the Daemon; pass the returned id in the RPC that consumes them. */
  readonly offer: <E>(source: BlobSource<E>) => Effect.Effect<BlobId>;
  /** Receive a blob the Daemon referenced in a response (e.g. `files.read`, `git.diff`). */
  readonly take: (blobId: BlobId) => Effect.Effect<Uint8Array, BlobError>;
  /** The same, chunk by chunk as it arrives, without holding the whole blob (e.g. terminal output). */
  readonly takeStream: (
    blobId: BlobId,
    options?: TakeStreamOptions
  ) => Stream.Stream<Uint8Array, BlobError>;
}

export interface RpcConnection {
  readonly client: DaemonClient;
  readonly blobs: ClientBlobs;
  readonly wire: Wire;
  /** Fails when the connection is gone: closed, broken, or the peer stopped answering pings. */
  readonly lost: Effect.Effect<never, RpcClientError>;
  /**
   * One protocol ping, timed to its pong: the link's round trip in ms, or null
   * after 5 s. The Daemon answers it without running a handler.
   */
  readonly roundTrip: Effect.Effect<number | null>;
}

export interface RpcConnectionOptions {
  readonly wire?: WireOptions;
  /**
   * Ping interval while a request (not a stream) awaits its reply; the
   * connection is declared dead after 3 intervals with no traffic.
   */
  readonly pingIntervalMs?: number;
}

/** Tags of the streaming RPCs: long-lived, so waiting on them never needs a ping. */
const streamTags: ReadonlySet<string> = new Set(
  [...DaemonRpcs.requests.values()].flatMap((rpc) =>
    RpcSchema.isStreamSchema(rpc.successSchema) ? [rpc._tag] : []
  )
);

const { ClientProtocolError } = Data.taggedEnum<FromServerEncoded>();

const isPong = Predicate.isTagged("Pong");

const isExit = Predicate.isTagged("Exit");

const lostError = (message: string, cause?: unknown) =>
  new RpcClientError({ reason: new RpcClientDefect({ message, cause }) });

export const connectRpc = Effect.fnUntraced(function* (
  transport: ClientTransport,
  options: RpcConnectionOptions = {}
): Effect.fn.Return<RpcConnection, never, Scope.Scope> {
  const serialization = RpcSerialization.json;
  const parser = serialization.makeUnsafe();
  const lost = yield* Deferred.make<never, RpcClientError>();
  const pingInterval = options.pingIntervalMs ?? 15_000;
  let lastHeard = Date.now();
  let wire!: Wire;
  /** Waiting for the next pong (`roundTrip`). */
  let pongWaiters: Array<Deferred.Deferred<void>> = [];
  /** Requests (not streams) sent and not yet answered with an Exit. */
  const awaiting = new Set<string | number>();
  /** Open while `awaiting` is non-empty: the ping loop runs only then. */
  const pinging = Latch.makeUnsafe(false);

  const settled = (requestId: string | number) => {
    awaiting.delete(requestId);

    if (awaiting.size === 0) pinging.closeUnsafe();
  };

  const protocol = yield* RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const requestClient = new Map<string | number, number>();
      let currentError: RpcClientError | undefined;

      const broadcast = (response: FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response), {
          discard: true,
        });

      const onJson = (text: string) =>
        Effect.suspend(() => {
          lastHeard = Date.now();
          let responses: ReadonlyArray<FromServerEncoded>;

          try {
            // SAFETY: as in effect/rpc's own socket protocol, the envelope from the Daemon is
            // trusted; RpcClient decodes each payload against its Rpc schema.
            responses = parser.decode(text) as ReadonlyArray<FromServerEncoded>;
          } catch (cause) {
            return broadcast(
              ClientProtocolError({
                error: lostError("error decoding a message from the Daemon", cause),
              })
            );
          }

          return Effect.forEach(
            responses,
            (response) => {
              if (isPong(response)) {
                const waiters = pongWaiters;
                pongWaiters = [];

                return Effect.forEach(waiters, (w) => Deferred.succeed(w, undefined), {
                  discard: true,
                });
              }

              if ("requestId" in response) {
                const clientId = requestClient.get(response.requestId);

                if (clientId !== undefined) {
                  if (isExit(response)) {
                    requestClient.delete(response.requestId);
                    settled(response.requestId);
                  }

                  return writeResponse(clientId, response);
                }
              }

              return broadcast(response);
            },
            { discard: true }
          );
        });

      wire = yield* makeWire(transport, onJson, { ...options.wire, blobIdPrefix: "c" });

      const fail = (error: RpcClientError) =>
        Effect.suspend(() => {
          if (currentError !== undefined) return Effect.void;
          currentError = error;

          // Fail in-flight requests first: completing `lost` lets the owner close
          // this scope, which would interrupt us before the broadcast.
          return Effect.andThen(
            broadcast(ClientProtocolError({ error })),
            Deferred.fail(lost, error)
          ).pipe(Effect.uninterruptible);
        });

      yield* wire.closed.pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          fail(
            Exit.isSuccess(exit)
              ? lostError("the Daemon closed the connection")
              : lostError(exit.cause.toString())
          )
        ),
        Effect.forkScoped
      );

      // Keepalive while a reply is due: any traffic counts as liveness, and
      // pings keep a quiet link busy. Parked on the latch (no timer) otherwise.
      yield* Effect.gen(function* () {
        while (true) {
          yield* pinging.await;
          yield* Effect.sleep(pingInterval);

          if (awaiting.size === 0) continue;

          if (Date.now() - lastHeard > pingInterval * 3) {
            yield* fail(lostError("the Daemon stopped answering"));

            return;
          }

          const ping = parser.encode(constPing);

          // The JSON serialization always encodes to a string.
          if (Predicate.isString(ping)) yield* Effect.ignore(wire.sendJson(ping));
        }
      }).pipe(Effect.forkScoped);

      return {
        send: (clientId, request) =>
          Effect.suspend(() => {
            if (currentError !== undefined) return Effect.fail(currentError);

            if (Predicate.isTagged(request, "Request")) {
              requestClient.set(request.id, clientId);

              if (!streamTags.has(request.tag)) {
                // The silence clock starts now, not at the last traffic of an idle link.
                if (awaiting.size === 0) lastHeard = Date.now();
                awaiting.add(request.id);
                pinging.openUnsafe();
              }
            } else if (Predicate.isTagged(request, "Interrupt")) {
              settled(request.requestId);
            }

            const encoded = parser.encode(request);

            if (!Predicate.isString(encoded)) return Effect.void;

            return wire
              .sendJson(encoded)
              .pipe(Effect.mapError((error) => lostError(error.message, error)));
          }),
        supportsAck: true,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      };
    })
  );

  const client = yield* RpcClient.make(DaemonRpcs, { spanPrefix: "polaris.rpc" }).pipe(
    Effect.provideService(RpcClient.Protocol, protocol)
  );

  return {
    client,
    wire,
    blobs: {
      offer: wire.offerBlob,
      take: (blobId) => wire.takeBlob(blobId),
      takeStream: (blobId, takeOptions) => wire.takeBlobStream(blobId, takeOptions),
    },
    lost: Deferred.await(lost),
    roundTrip: Effect.gen(function* () {
      const pong = yield* Deferred.make<void>();
      const ping = parser.encode(constPing);

      if (!Predicate.isString(ping)) return null;
      pongWaiters.push(pong);
      const started = performance.now();
      yield* Effect.ignore(wire.sendJson(ping));
      const answered = yield* Deferred.await(pong).pipe(Effect.timeoutOption(5000));

      return Option.isSome(answered) ? Math.round(performance.now() - started) : null;
    }),
  };
});
