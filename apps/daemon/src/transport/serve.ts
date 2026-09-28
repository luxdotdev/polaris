/**
 * `polaris serve`: run the Daemon until SIGINT / SIGTERM.
 *
 * Handler layers from other Daemon modules are added to `daemonHandlers`
 * below as they land; `startServer` falls back to placeholders for the rest.
 */
import { BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { startServer } from "./server.ts"

/** Exit status when another Daemon already holds the lock or answers on the socket. */
export const SERVE_EXIT_ALREADY_RUNNING = 75

/** Every real handler layer the Daemon mounts. Compose new modules' layers here. */
export const daemonHandlers = Layer.empty

export const serveProgram = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* startServer({ handlers: daemonHandlers })
    yield* Effect.logInfo(`polaris Daemon listening on ${server.socketPath}`)
    return yield* Effect.never
  }),
).pipe(
  Effect.catchTag("DaemonAlreadyRunning", (error) =>
    Effect.sync(() => {
      process.stderr.write(`polaris serve: ${error.message}\n`)
      process.exit(SERVE_EXIT_ALREADY_RUNNING)
    }),
  ),
)

export const runServe = () => BunRuntime.runMain(serveProgram)
