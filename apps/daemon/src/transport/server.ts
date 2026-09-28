/**
 * The Daemon's RPC server: `ServerRpcs` over the Unix socket, one framed Wire
 * per Client connection.
 *
 * The `RpcServer.Protocol` below mirrors effect/rpc's socket server protocol
 * (`makeSocketProtocol` in effect@4.0.0-rc.118 `RpcServer.ts`), with the
 * socket's byte stream replaced by a Wire: each RPC message is one JSON frame
 * (serialized with `RpcSerialization.json`), and blobs travel beside them as
 * binary chunks. Handler layers are composed here, in one place: the defaults
 * from `handlers.ts` first, then whatever the caller passes, which wins.
 */
import type { Socket } from "node:net"
import {
  type Capability,
  type HostInfo,
  makeWire,
  type Wire,
  type WireOptions,
} from "@polaris/protocol"
import { Effect, Latch, Layer, Queue, Schema, type Scope, Stream } from "effect"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { ResponseDefectEncoded } from "effect/rpc/RpcMessage"
import { paths } from "../paths.ts"
import { BlobChannel, ServiceError } from "../services.ts"
import { defaultHandlers } from "./handlers.ts"
import { loadHostInfo } from "./hostInfo.ts"
import { acquireLock, type DaemonAlreadyRunning, type LockError } from "./lock.ts"
import { fromNodeSocket } from "./nodeTransport.ts"
import { ConnectionBlobs, ServerRpcs } from "./rpcs.ts"
import { listen, prepareSocketPath } from "./socket.ts"

/** Capabilities the transport itself provides. Handler modules add theirs via `capabilities`. */
export const TRANSPORT_CAPABILITIES: ReadonlyArray<Capability> = ["blobs"]

export interface ServeOptions<ROut, E, RIn> {
  /** Real handlers; any RPC they don't cover falls back to the placeholders. */
  readonly handlers?: Layer.Layer<ROut, E, RIn>
  /** Extra capabilities announced in `hello`, on top of TRANSPORT_CAPABILITIES. */
  readonly capabilities?: ReadonlyArray<Capability>
  /** Overrides for tests; default to `paths()`. */
  readonly socketPath?: string
  readonly lockPath?: string
  readonly root?: string
  readonly wire?: WireOptions
}

export interface RunningServer {
  readonly socketPath: string
  readonly hostInfo: HostInfo
  /** Number of Clients connected right now. */
  readonly connections: () => number
}

const blobChannelFor = (wire: Wire): BlobChannel["Service"] =>
  BlobChannel.of({
    offer: (bytes) => wire.offerBlob(bytes),
    take: (blobId) =>
      wire.takeBlob(blobId).pipe(
        Effect.mapError(
          (error) =>
            new ServiceError({
              service: "transport",
              message: `blob ${error.blobId}: ${error.reason}: ${error.message}`,
            }),
        ),
      ),
  })

/**
 * Starts the Daemon's server for the lifetime of the scope: takes the lock,
 * clears a stale socket, listens, and serves every Client that connects.
 */
export const startServer = <ROut = never, E = never, RIn = never>(
  options: ServeOptions<ROut, E, RIn> = {},
): Effect.Effect<
  RunningServer,
  DaemonAlreadyRunning | LockError | ServiceError | E,
  Scope.Scope | RIn
> =>
  Effect.gen(function* () {
    const defaults = paths()
    const socketPath = options.socketPath ?? defaults.socket
    const lockPath = options.lockPath ?? defaults.lock
    yield* acquireLock(lockPath)
    yield* prepareSocketPath(socketPath)
    const hostInfo = yield* loadHostInfo(options.root ?? defaults.root)
    const capabilities = [...new Set([...TRANSPORT_CAPABILITIES, ...(options.capabilities ?? [])])]

    const serialization = RpcSerialization.json
    const encoder = serialization.makeUnsafe()
    const encodeDefect = Schema.encodeSync(serialization.codecFor(Schema.Defect()))
    const connections = new Map<
      number,
      { readonly wire: Wire; readonly blobs: BlobChannel["Service"] }
    >()
    const disconnects = yield* Queue.unbounded<number>()
    let writeRequest!: Parameters<Parameters<typeof RpcServer.Protocol.make>[0]>[0]

    const protocol = yield* RpcServer.Protocol.make((write) => {
      writeRequest = write
      return Effect.succeed({
        disconnects,
        send: (clientId, response) => {
          const connection = connections.get(clientId)
          if (connection === undefined) return Effect.void
          let text: string | Uint8Array | undefined
          try {
            text = encoder.encode(response)
          } catch (cause) {
            text = encoder.encode(ResponseDefectEncoded(encodeDefect(cause)))
          }
          if (text === undefined) return Effect.void
          return Effect.ignore(connection.wire.sendJson(text as string))
        },
        end: () => Effect.void,
        clientIds: Effect.sync(() => new Set(connections.keys())),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      })
    })

    const blobsMiddleware = ConnectionBlobs.of((effect, { client }) => {
      const connection = connections.get(client.id)
      return connection === undefined
        ? Effect.die(new Error(`no connection for client ${client.id}`))
        : Effect.provideService(effect, BlobChannel, connection.blobs)
    })

    const handlers = yield* Layer.build(
      Layer.merge(
        defaultHandlers({ hostInfo, capabilities }),
        (options.handlers ?? Layer.empty) as Layer.Layer<ROut, E, RIn>,
      ),
    )

    yield* RpcServer.make(ServerRpcs, { spanPrefix: "polaris.rpc" }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provideService(ConnectionBlobs, blobsMiddleware),
      Effect.provideContext(handlers),
      Effect.forkScoped,
    )

    let nextClientId = 0
    const serveConnection = (socket: Socket) =>
      Effect.scoped(
        Effect.gen(function* () {
          const clientId = nextClientId++
          const ready = Latch.makeUnsafe(false)
          const decoder = serialization.makeUnsafe()
          const onJson = (text: string) =>
            Effect.andThen(
              ready.await,
              Effect.suspend(() => {
                let messages: ReadonlyArray<unknown>
                try {
                  messages = decoder.decode(text)
                } catch (cause) {
                  return Effect.logWarning("dropping an undecodable message", cause)
                }
                return Effect.forEach(
                  messages,
                  (message) => writeRequest(clientId, message as never),
                  { discard: true },
                )
              }),
            )
          const wire = yield* makeWire(fromNodeSocket(socket), onJson, {
            ...options.wire,
            blobIdPrefix: "d",
          })
          connections.set(clientId, { wire, blobs: blobChannelFor(wire) })
          yield* Effect.addFinalizer(() =>
            Effect.andThen(
              Effect.sync(() => connections.delete(clientId)),
              Queue.offer(disconnects, clientId),
            ),
          )
          ready.openUnsafe()
          yield* Effect.ignore(wire.closed)
        }),
      )

    const scope = yield* Effect.scope
    const accepted = yield* listen(socketPath)
    yield* accepted.pipe(
      Stream.runForEach((socket) => Effect.forkIn(serveConnection(socket), scope)),
      Effect.forkScoped,
    )

    return { socketPath, hostInfo, connections: () => connections.size }
  })
