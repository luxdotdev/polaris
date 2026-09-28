/**
 * Byte transports a Client connects over: a child process's stdio (normally
 * `ssh <alias> polaris bridge`) or the local Daemon's Unix socket.
 *
 * Each transport can explain, after it failed, why: `diagnose` classifies the
 * exit status and stderr into a ConnectFailure the Connection State uses.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { connect } from "node:net"
import { type ByteTransport, TransportError } from "@polaris/protocol"
import { Deferred, Effect, Exit, type Scope, Stream } from "effect"
import { ConnectFailure, classifyExit } from "./failures.ts"

export interface ClientTransport extends ByteTransport {
  /** Why the transport closed or failed; waits briefly for the process to exit. */
  readonly diagnose: Effect.Effect<ConnectFailure>
}

/** How a HostConnection opens its transport. Injectable, so tests can replace `ssh`. */
export type Connector = Effect.Effect<ClientTransport, ConnectFailure, Scope.Scope>

interface WritableLike {
  readonly destroyed: boolean
  readonly writable: boolean
  write(chunk: Uint8Array): boolean
  on(event: "drain" | "close" | "error", listener: (...args: Array<unknown>) => void): unknown
  off(event: "drain" | "close" | "error", listener: (...args: Array<unknown>) => void): unknown
}

const writeTo =
  (stream: WritableLike) =>
  (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.callback<void, TransportError>((resume) => {
      if (stream.destroyed || !stream.writable) {
        resume(Effect.fail(new TransportError({ message: "transport closed" })))
        return
      }
      if (stream.write(bytes)) {
        resume(Effect.void)
        return
      }
      const cleanup = () => {
        stream.off("drain", onDrain)
        stream.off("close", onClose)
        stream.off("error", onClose)
      }
      const onDrain = () => {
        cleanup()
        resume(Effect.void)
      }
      const onClose = () => {
        cleanup()
        resume(Effect.fail(new TransportError({ message: "transport closed while writing" })))
      }
      stream.on("drain", onDrain)
      stream.on("close", onClose)
      stream.on("error", onClose)
      return Effect.sync(cleanup)
    })

const readFrom = (stream: AsyncIterable<Uint8Array>) =>
  Stream.fromAsyncIterable(
    stream,
    (cause) => new TransportError({ message: "transport read failed", cause }),
  )

const STDERR_LIMIT = 16 * 1024

export interface SpawnOptions {
  readonly env?: Record<string, string | undefined>
  /** Grace period after stdin closes before the process is killed. */
  readonly killAfterMs?: number
}

/** Runs `argv` and speaks the wire over its stdin/stdout. */
export const spawnTransport = (
  argv: ReadonlyArray<string>,
  options: SpawnOptions = {},
): Connector =>
  Effect.gen(function* () {
    const [command, ...args] = argv
    if (command === undefined) {
      return yield* new ConnectFailure({
        kind: "needs-attention",
        reason: "command-missing",
        detail: "empty command",
      })
    }
    const exited = yield* Deferred.make<{ code: number | null; signal: string | null }>()
    let stderr = ""
    let spawnError: NodeJS.ErrnoException | null = null

    const child: ChildProcess = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const child = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: options.env ?? process.env,
        })
        child.on("error", (error: NodeJS.ErrnoException) => {
          spawnError = error
          Deferred.doneUnsafe(exited, Exit.succeed({ code: null, signal: null }))
        })
        // `exit`, not `close`: an SSH ControlPersist master may keep stderr open for minutes.
        child.on("exit", (code, signal) =>
          Deferred.doneUnsafe(exited, Exit.succeed({ code, signal })),
        )
        child.stderr?.on("data", (chunk: Uint8Array) => {
          stderr = (stderr + new TextDecoder().decode(chunk)).slice(-STDERR_LIMIT)
        })
        child.stdin?.on("error", () => {})
        return child
      }),
      (child) =>
        Effect.gen(function* () {
          child.stdin?.end()
          const done = yield* Deferred.await(exited).pipe(
            Effect.timeoutOption(options.killAfterMs ?? 2000),
          )
          if (done._tag === "None") child.kill("SIGTERM")
          child.stderr?.destroy()
          child.stdout?.destroy()
        }),
    )

    const stdin = child.stdin
    const stdout = child.stdout
    if (stdin === null || stdout === null) {
      return yield* new ConnectFailure({
        kind: "transient",
        reason: "spawn-failed",
        detail: "no stdio pipes",
      })
    }

    const diagnose = Deferred.await(exited).pipe(
      Effect.timeoutOption(3000),
      Effect.map((exit) =>
        spawnError !== null
          ? new ConnectFailure({
              kind: "needs-attention",
              reason: command === "ssh" ? "ssh-missing" : "command-missing",
              detail: `${command}: ${spawnError.code ?? spawnError.message}`,
            })
          : classifyExit({
              code: exit._tag === "Some" ? exit.value.code : null,
              signal: exit._tag === "Some" ? exit.value.signal : null,
              stderr,
            }),
      ),
    )

    return {
      incoming: readFrom(stdout as AsyncIterable<Uint8Array>),
      write: writeTo(stdin as unknown as WritableLike),
      close: Effect.sync(() => {
        stdin.end()
      }),
      diagnose,
    } satisfies ClientTransport
  })

/** Connects straight to a Daemon's Unix socket (the local Host). */
export const socketTransport = (path: string): Connector =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      Effect.callback<import("node:net").Socket, ConnectFailure>((resume) => {
        const socket = connect(path)
        const onError = (error: NodeJS.ErrnoException) =>
          resume(
            Effect.fail(
              error.code === "ENOENT" || error.code === "ECONNREFUSED"
                ? new ConnectFailure({
                    kind: "needs-attention",
                    reason: "daemon-not-running",
                    detail: `no Daemon is listening on ${path}`,
                  })
                : new ConnectFailure({
                    kind: "transient",
                    reason: "connection-failed",
                    detail: `${path}: ${error.code ?? error.message}`,
                  }),
            ),
          )
        socket.once("error", onError)
        socket.once("connect", () => {
          socket.off("error", onError)
          socket.on("error", () => {})
          resume(Effect.succeed(socket))
        })
      }),
      (socket) => Effect.sync(() => socket.destroy()),
    )
    return {
      incoming: readFrom(socket as AsyncIterable<Uint8Array>),
      write: writeTo(socket as unknown as WritableLike),
      close: Effect.sync(() => {
        socket.end()
      }),
      diagnose: Effect.succeed(
        new ConnectFailure({
          kind: "transient",
          reason: "connection-lost",
          detail: `the Daemon closed ${path}`,
        }),
      ),
    } satisfies ClientTransport
  })
