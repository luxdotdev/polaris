/**
 * Byte transports a Client connects over: a child process's stdio (normally
 * `ssh <alias> polaris bridge`) or the local Daemon's Unix socket.
 *
 * Each transport can explain, after it failed, why: `diagnose` classifies the
 * exit status and stderr into a ConnectFailure the Connection State uses.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { connect, type Socket } from "node:net"
import {
  type ByteTransport,
  type EventReadable,
  type EventWritable,
  readEvents,
  writeEvents,
} from "@polaris/protocol"
import { Deferred, Effect, Exit, type Scope } from "effect"
import { ConnectFailure, classifyExit } from "./failures.ts"

export interface ClientTransport extends ByteTransport {
  /** Why the transport closed or failed; waits briefly for the process to exit. */
  readonly diagnose: Effect.Effect<ConnectFailure>
}

/** How a HostConnection opens its transport. Injectable, so tests can replace `ssh`. */
export type Connector = Effect.Effect<ClientTransport, ConnectFailure, Scope.Scope>

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

    const { child, incoming } = yield* Effect.acquireRelease(
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
        // Attach the reader now, before any output can arrive.
        const incoming =
          child.stdout === null ? null : readEvents(child.stdout as unknown as EventReadable)
        return { child: child as ChildProcess, incoming }
      }),
      ({ child }) =>
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
    if (stdin === null || incoming === null) {
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
      incoming,
      write: writeEvents(stdin as unknown as EventWritable),
      close: Effect.sync(() => {
        stdin.end()
      }),
      diagnose,
    } satisfies ClientTransport
  })

/** Connects straight to a Daemon's Unix socket (the local Host). */
export const socketTransport = (path: string): Connector =>
  Effect.gen(function* () {
    const { socket, incoming } = yield* Effect.acquireRelease(
      Effect.callback<
        { readonly socket: Socket; readonly incoming: ByteTransport["incoming"] },
        ConnectFailure
      >((resume) => {
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
          resume(
            Effect.succeed({ socket, incoming: readEvents(socket as unknown as EventReadable) }),
          )
        })
      }),
      ({ socket }) => Effect.sync(() => socket.destroy()),
    )
    return {
      incoming,
      write: writeEvents(socket as unknown as EventWritable),
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
