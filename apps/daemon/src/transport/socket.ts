/**
 * The Daemon's only listener: a Unix socket at `paths().socket`, mode 0600 in
 * a 0700 directory. Remote Clients reach it through `polaris bridge` over SSH.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs"
import { connect, createServer, type Server } from "node:net"
import { dirname } from "node:path"
import type { ByteTransport } from "@polaris/protocol"
import { Effect, Queue, type Scope, Stream } from "effect"
import { DaemonAlreadyRunning, LockError } from "./lock.ts"
import { fromNodeSocket } from "./nodeTransport.ts"

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

/** Listens on `path` for the lifetime of the scope; emits a transport per accepted connection. */
export const listen = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<Stream.Stream<ByteTransport>, LockError, Scope.Scope> {
  const connections = yield* Queue.unbounded<ByteTransport>()
  const server = yield* Effect.acquireRelease(
    Effect.callback<Server, LockError>((resume) => {
      const server = createServer({ allowHalfOpen: false }, (socket) => {
        Queue.offerUnsafe(connections, fromNodeSocket(socket))
      })
      // Create the socket file private from the start rather than chmod-ing after the fact.
      const previousUmask = process.umask(0o177)
      const onError = (cause: Error) => {
        process.umask(previousUmask)
        resume(Effect.fail(new LockError({ path, message: `cannot listen: ${cause.message}` })))
      }
      server.once("error", onError)
      server.listen(path, () => {
        process.umask(previousUmask)
        server.off("error", onError)
        try {
          chmodSync(path, 0o600)
        } catch {}
        resume(Effect.succeed(server))
      })
    }),
    (server) =>
      Effect.sync(() => {
        server.close()
        try {
          unlinkSync(path)
        } catch {}
      }),
  )
  server.on("error", () => {})
  return Stream.fromQueue(connections)
})
