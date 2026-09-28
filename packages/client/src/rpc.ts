/**
 * Runs an effect/rpc client for `DaemonRpcs` over one framed Wire.
 *
 * The `RpcClient.Protocol` mirrors effect/rpc's socket client protocol
 * (`makeProtocolSocket` in effect@4.0.0-rc.118 `RpcClient.ts`): requests are
 * routed back to the RpcClient that sent them, a lost connection fails every
 * in-flight request with an RpcClientError, and a ping loop detects a dead
 * peer. Unlike it, there is no built-in retry: a Wire is one connection, and
 * HostConnection owns reconnecting.
 */
import {
  type BlobError,
  type BlobId,
  type BlobSource,
  DaemonRpcs,
  makeWire,
  type Wire,
  type WireOptions,
} from "@polaris/protocol"
import { Deferred, Effect, type Scope } from "effect"
import { RpcClient, type RpcGroup, RpcSerialization } from "effect/rpc"
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError"
import { constPing, type FromServerEncoded } from "effect/rpc/RpcMessage"
import type { ClientTransport } from "./transport.ts"

export type DaemonClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof DaemonRpcs>, RpcClientError>

export interface ClientBlobs {
  /** Send bytes to the Daemon; pass the returned id in the RPC that consumes them. */
  readonly offer: <E>(source: BlobSource<E>) => Effect.Effect<BlobId>
  /** Receive a blob the Daemon referenced in a response (e.g. `files.read`, `git.diff`). */
  readonly take: (blobId: BlobId) => Effect.Effect<Uint8Array, BlobError>
}

export interface RpcConnection {
  readonly client: DaemonClient
  readonly blobs: ClientBlobs
  readonly wire: Wire
  /** Fails when the connection is gone: closed, broken, or the peer stopped answering pings. */
  readonly lost: Effect.Effect<never, RpcClientError>
}

export interface RpcConnectionOptions {
  readonly wire?: WireOptions
  /** Ping interval; the connection is declared dead after 3 intervals with no traffic. */
  readonly pingIntervalMs?: number
}

const lostError = (message: string, cause?: unknown) =>
  new RpcClientError({ reason: new RpcClientDefect({ message, cause }) })

export const connectRpc = Effect.fnUntraced(function* (
  transport: ClientTransport,
  options: RpcConnectionOptions = {},
): Effect.fn.Return<RpcConnection, never, Scope.Scope> {
  const serialization = RpcSerialization.json
  const parser = serialization.makeUnsafe()
  const lost = yield* Deferred.make<never, RpcClientError>()
  const pingInterval = options.pingIntervalMs ?? 15_000
  let lastHeard = Date.now()
  let wire!: Wire

  const protocol = yield* RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const requestClient = new Map<string | number, number>()
      let currentError: RpcClientError | undefined

      const broadcast = (response: FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response), {
          discard: true,
        })

      const onJson = (text: string) =>
        Effect.suspend(() => {
          lastHeard = Date.now()
          let responses: ReadonlyArray<FromServerEncoded>
          try {
            responses = parser.decode(text) as ReadonlyArray<FromServerEncoded>
          } catch (cause) {
            return broadcast({
              _tag: "ClientProtocolError",
              error: lostError("error decoding a message from the Daemon", cause),
            })
          }
          return Effect.forEach(
            responses,
            (response) => {
              if (response._tag === "Pong") return Effect.void
              if ("requestId" in response) {
                const clientId = requestClient.get(response.requestId)
                if (clientId !== undefined) {
                  if (response._tag === "Exit") requestClient.delete(response.requestId)
                  return writeResponse(clientId, response)
                }
              }
              return broadcast(response)
            },
            { discard: true },
          )
        })

      wire = yield* makeWire(transport, onJson, { ...options.wire, blobIdPrefix: "c" })

      const fail = (error: RpcClientError) =>
        Effect.suspend(() => {
          if (currentError !== undefined) return Effect.void
          currentError = error
          // Fail in-flight requests first: completing `lost` lets the owner close
          // this scope, which would interrupt us before the broadcast.
          return Effect.andThen(
            broadcast({ _tag: "ClientProtocolError", error }),
            Deferred.fail(lost, error),
          ).pipe(Effect.uninterruptible)
        })

      yield* wire.closed.pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          fail(
            exit._tag === "Success"
              ? lostError("the Daemon closed the connection")
              : lostError(exit.cause.toString()),
          ),
        ),
        Effect.forkScoped,
      )

      // Keepalive: any traffic counts as liveness; pings keep a quiet link busy.
      yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(pingInterval)
          if (Date.now() - lastHeard > pingInterval * 3) {
            yield* fail(lostError("the Daemon stopped answering"))
            return
          }
          yield* Effect.ignore(wire.sendJson(parser.encode(constPing) as string))
        }
      }).pipe(Effect.forkScoped)

      return {
        send: (clientId, request) =>
          Effect.suspend(() => {
            if (currentError !== undefined) return Effect.fail(currentError)
            if (request._tag === "Request") requestClient.set(request.id, clientId)
            const encoded = parser.encode(request)
            if (encoded === undefined) return Effect.void
            return wire
              .sendJson(encoded as string)
              .pipe(Effect.mapError((error) => lostError(error.message, error)))
          }),
        supportsAck: true,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      }
    }),
  )

  const client = yield* RpcClient.make(DaemonRpcs, { spanPrefix: "polaris.rpc" }).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )

  return {
    client,
    wire,
    blobs: { offer: wire.offerBlob, take: (blobId) => wire.takeBlob(blobId) },
    lost: Deferred.await(lost),
  }
})
