/**
 * The Daemon's only listener: a Unix socket at `paths().socket`, mode 0600 in
 * a 0700 directory. Remote Clients reach it through `polaris bridge` over SSH.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs"
import { connect } from "node:net"
import { dirname } from "node:path"
import type { ByteTransport } from "@polaris/protocol"
import { Effect, Queue, type Scope, Stream } from "effect"
import {
  type AdoptedListener,
  bindAtomically,
  connectFd,
  listenerFd,
  type UpgradeError,
} from "../service/upgrade.ts"
import { type BunSocketStream, socketHandlers } from "./bunSocket.ts"
import { DaemonAlreadyRunning, LockError } from "./lock.ts"

/** True when something accepts connections on `path`. */
export const probeSocket = (path: string, timeoutMs = 1000): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const socket = connect(path)
    const done = (alive: boolean) => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resume(Effect.succeed(alive))
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })

/**
 * Makes the socket directory private and clears a stale socket file: one left
 * by a Daemon that died without cleaning up. A live socket is never touched.
 */
export const prepareSocketPath = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<void, DaemonAlreadyRunning | LockError> {
  const dir = dirname(path)
  yield* Effect.try({
    try: () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      chmodSync(dir, 0o700)
    },
    catch: (cause) => new LockError({ path: dir, message: String(cause) }),
  })
  if (!existsSync(path)) return
  if (yield* probeSocket(path)) return yield* new DaemonAlreadyRunning({ pid: null, path })
  yield* Effect.try({
    try: () => {
      if (lstatSync(path).isDirectory()) throw new Error(`${path} is a directory`)
      unlinkSync(path)
    },
    catch: (cause) => new LockError({ path, message: `cannot remove stale socket: ${cause}` }),
  })
})

export interface Listener {
  /** A transport per accepted connection. */
  readonly connections: Stream.Stream<ByteTransport>
  /** The listening fd, for the upgrade hand-off. */
  readonly fd: () => number | null
  /** Serve the connections queued on a listener inherited across an upgrade. */
  readonly adopt: (adopted: AdoptedListener) => Effect.Effect<number, UpgradeError>
}

/**
 * Listens on `path` for the lifetime of the scope. Binds at a temporary path
 * and renames it into place (`bindAtomically`), so the socket path never
 * refuses connections, even while a new image takes over during an upgrade.
 */
export const listen = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<Listener, LockError, Scope.Scope> {
  const connections = yield* Queue.unbounded<ByteTransport>()
  const handlers = socketHandlers((transport) => {
    Queue.offerUnsafe(connections, transport)
  })
  const server = yield* Effect.acquireRelease(
    bindAtomically(path, (temporary) =>
      Effect.try({
        try: () => {
          // Create the socket file private from the start rather than chmod-ing after the fact.
          const previousUmask = process.umask(0o177)
          try {
            return Bun.listen<BunSocketStream | undefined>({ unix: temporary, socket: handlers })
          } finally {
            process.umask(previousUmask)
          }
        },
        catch: (cause) => new LockError({ path, message: `cannot listen: ${cause}` }),
      }),
    ).pipe(
      Effect.mapError((error) =>
        error._tag === "LockError" ? error : new LockError({ path, message: error.message }),
      ),
    ),
    (server) =>
      Effect.sync(() => {
        server.stop(true)
        try {
          unlinkSync(path)
        } catch {}
      }),
  )
  yield* Effect.sync(() => {
    try {
      chmodSync(path, 0o600)
    } catch {}
  })
  return {
    connections: Stream.fromQueue(connections),
    fd: () => {
      try {
        return listenerFd(server)
      } catch {
        return null
      }
    },
    adopt: (adopted) =>
      adopted.drain((fd) => {
        void connectFd(fd, handlers)
      }),
  }
})
