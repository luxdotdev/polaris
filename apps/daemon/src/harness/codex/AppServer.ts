/**
 * The one `codex app-server` per Host, owned by the Daemon and shared by every
 * Codex Agent Session and by the user's own `codex --remote` TUI.
 *
 * It listens on a Unix socket (`codex app-server --listen unix://<path>`) and
 * is started lazily on the first `open`. If a server is already answering on
 * the socket (for example one left running by a previous Daemon), it is reused
 * so live threads survive a Daemon restart. A server this Daemon spawned is
 * stopped when the driver's scope closes.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { Effect, type Scope, Semaphore } from "effect"
import type { HarnessError } from "../HarnessDriver.ts"
import { codexError, connectUnix, type RpcConnection } from "./RpcConnection.ts"

export interface AppServerOptions {
  readonly codexPath: string | null
  readonly socketPath: string
  /** False: only connect to a server someone else runs (tests, externally managed servers). */
  readonly spawn: boolean
  readonly startTimeoutMs?: number
}

export interface AppServer {
  readonly socketPath: string
  /** Connects to the shared server, starting it first if nothing answers on the socket. */
  readonly connect: Effect.Effect<RpcConnection, HarnessError, Scope.Scope>
}

/** True when something accepts a WebSocket upgrade on the socket. */
const isAnswering = (socketPath: string) =>
  Effect.scoped(connectUnix(socketPath)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  )

export const makeAppServer = (
  options: AppServerOptions,
): Effect.Effect<AppServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    let child: Bun.Subprocess<"ignore", "ignore", "pipe"> | null = null
    let stderrTail = ""

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (child !== null && child.exitCode === null) child.kill("SIGTERM")
        child = null
      }),
    )

    const spawn = Effect.gen(function* () {
      if (options.codexPath === null)
        return yield* codexError("codex was not found on PATH; install Codex to use it")
      mkdirSync(dirname(options.socketPath), { recursive: true })
      if (existsSync(options.socketPath)) rmSync(options.socketPath, { force: true })
      const proc = yield* Effect.try({
        try: () =>
          Bun.spawn(
            [options.codexPath!, "app-server", "--listen", `unix://${options.socketPath}`],
            { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
          ),
        catch: (cause) => codexError("Failed to start codex app-server", cause),
      })
      child = proc
      stderrTail = ""
      void (async () => {
        const decoder = new TextDecoder()
        for await (const chunk of proc.stderr) {
          stderrTail = (stderrTail + decoder.decode(chunk)).slice(-4000)
        }
      })()

      const deadline = Date.now() + (options.startTimeoutMs ?? 15_000)
      while (Date.now() < deadline) {
        if (proc.exitCode !== null)
          return yield* codexError(
            `codex app-server exited with ${proc.exitCode}: ${stderrTail.trim()}`,
          )
        if (yield* isAnswering(options.socketPath)) return
        yield* Effect.sleep("100 millis")
      }
      proc.kill("SIGTERM")
      return yield* codexError(`codex app-server did not start listening on ${options.socketPath}`)
    })

    const ensureRunning = lock.withPermits(1)(
      Effect.gen(function* () {
        if (child !== null && child.exitCode === null) return
        if (yield* isAnswering(options.socketPath)) return
        if (!options.spawn)
          return yield* codexError(`No Codex app-server is listening on ${options.socketPath}`)
        yield* spawn
      }),
    )

    return {
      socketPath: options.socketPath,
      connect: Effect.andThen(ensureRunning, connectUnix(options.socketPath)),
    } satisfies AppServer
  })
