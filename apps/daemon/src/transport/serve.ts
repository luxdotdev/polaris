/**
 * `polaris serve`: run the Daemon until SIGINT / SIGTERM.
 *
 * Handler layers from other Daemon modules are added to `daemonHandlers`
 * below as they land; `startServer` falls back to placeholders for the rest.
 */
import { BunRuntime } from "@effect/platform-bun"
import type { Capability } from "@polaris/protocol"
import { Effect, Layer } from "effect"
import { AttachmentRpcsLive } from "../attachments/AttachmentRpcs.ts"
import { AttachmentStoreLive } from "../attachments/AttachmentStore.ts"
import { Engine } from "../engine/Engine.ts"
import { EngineRpcHandlers } from "../engine/rpc.ts"
import { FileSearchLive } from "../files/FileSearch.ts"
import { FilesRpcsLive } from "../files/FilesRpcs.ts"
import { CheckpointsLive } from "../git/Checkpoints.ts"
import { GitRpcsLive } from "../git/GitRpcs.ts"
import { WorktreeTrackerLive } from "../git/WorktreeTracker.ts"
import { HarnessRegistryLive } from "../harness/registry.ts"
import { EventStore } from "../store/EventStore.ts"
import { TerminalRpcsLive } from "../terminal/TerminalRpcs.ts"
import { TerminalsLive } from "../terminal/Terminals.ts"
import { startServer } from "./server.ts"

/** Exit status when another Daemon already holds the lock or answers on the socket. */
export const SERVE_EXIT_ALREADY_RUNNING = 75

/** The services behind the handlers: the event store and engine, git, attachments, Harnesses. */
const daemonServices = Engine.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      EventStore.layerLive,
      HarnessRegistryLive,
      CheckpointsLive,
      WorktreeTrackerLive,
      AttachmentStoreLive(),
    ),
  ),
)

/** Every real handler layer the Daemon mounts. Compose new modules' layers here. */
export const daemonHandlers = Layer.mergeAll(
  EngineRpcHandlers,
  FilesRpcsLive.pipe(Layer.provide(FileSearchLive())),
  GitRpcsLive,
  AttachmentRpcsLive,
  TerminalRpcsLive.pipe(Layer.provide(TerminalsLive)),
).pipe(Layer.provide(daemonServices))

export const daemonCapabilities: ReadonlyArray<Capability> = [
  "harness.claude",
  "harness.codex",
  "session.steer",
  "session.fork",
  "session.terminal-handoff",
  "files.read",
  "files.search",
  "files.watch",
  "git.diff",
  "attachments.stage",
  "terminal",
]

export const serveProgram = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* startServer({
      handlers: daemonHandlers,
      capabilities: daemonCapabilities,
      upgrades: true,
    })
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
