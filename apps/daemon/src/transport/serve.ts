/**
 * `polaris serve`: run the Daemon until SIGINT / SIGTERM.
 *
 * Handler layers from other Daemon modules are added to `daemonHandlers`
 * below as they land; `startServer` falls back to placeholders for the rest.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { type Capability, HARNESS_CATALOGUE } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { AttachmentRpcsLive } from "../attachments/AttachmentRpcs.ts";
import { AttachmentStoreLive } from "../attachments/AttachmentStore.ts";
import { installDebugHooks } from "../debug.ts";
import { Engine } from "../engine/Engine.ts";
import { EngineRpcHandlers } from "../engine/rpc.ts";
import { FileSearchLive } from "../files/FileSearch.ts";
import { FilesRpcsLive } from "../files/FilesRpcs.ts";
import { CheckpointsLive } from "../git/Checkpoints.ts";
import { GitRpcsLive } from "../git/GitRpcs.ts";
import { WorktreeTrackerLive } from "../git/WorktreeTracker.ts";
import { HarnessRpcsLive } from "../harness/HarnessRpcs.ts";
import { HarnessRegistryLive } from "../harness/registry.ts";
import { EventStore } from "../store/EventStore.ts";
import { TerminalRpcsLive } from "../terminal/TerminalRpcs.ts";
import { TerminalsDaemonLive } from "../terminal/Terminals.ts";
import { startServer } from "./server.ts";

/** Exit status when another Daemon already holds the lock or answers on the socket. */
export const SERVE_EXIT_ALREADY_RUNNING = 75;

/** The services behind the handlers: the event store and engine, git, attachments, Harnesses. */
const daemonServices = Engine.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      EventStore.layerLive,
      HarnessRegistryLive,
      CheckpointsLive,
      WorktreeTrackerLive,
      AttachmentStoreLive()
    )
  )
);

/** Every real handler layer the Daemon mounts. Compose new modules' layers here. */
export const daemonHandlers = Layer.mergeAll(
  EngineRpcHandlers,
  FilesRpcsLive.pipe(Layer.provide(FileSearchLive())),
  GitRpcsLive,
  AttachmentRpcsLive,
  HarnessRpcsLive,
  TerminalRpcsLive.pipe(Layer.provide(TerminalsDaemonLive))
).pipe(Layer.provide(daemonServices));

// `harness.models`, `session.set-model` and `usage` wait for the drivers (ENG-201, ENG-202).
export const daemonCapabilities: ReadonlyArray<Capability> = [
  ...HARNESS_CATALOGUE.map((harness) => harness.capability),
  "session.steer",
  "session.fork",
  "session.terminal-handoff",
  "session.terminal-command",
  "session.live-items",
  "files.read",
  "files.search",
  "files.watch",
  "git.diff",
  "attachments.stage",
  "terminal",
  "terminal.binary",
];

export const serveProgram = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* startServer({
      handlers: daemonHandlers,
      capabilities: daemonCapabilities,
      upgrades: true,
    });

    yield* Effect.logInfo(`polaris Daemon listening on ${server.socketPath}`);

    return yield* Effect.never;
  })
).pipe(
  Effect.catchTag("DaemonAlreadyRunning", (error) =>
    Effect.sync(() => {
      process.stderr.write(`polaris serve: ${error.message}\n`);
      process.exit(SERVE_EXIT_ALREADY_RUNNING);
    })
  )
);

export const runServe = () => {
  installDebugHooks();
  BunRuntime.runMain(serveProgram);
};
