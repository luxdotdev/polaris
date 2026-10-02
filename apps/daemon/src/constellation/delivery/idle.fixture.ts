import { join } from "node:path";
import {
  AgentSession,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  DomainEvent,
  HostId,
  SessionId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationOwner } from "../runtime.ts";
import { ConstellationDelivery, ConstellationSessionEffects } from "./index.ts";

const home = process.env.POLARIS_HOME;

if (!home) throw new Error("The idle fixture requires a temporary POLARIS_HOME");

const enabled = process.argv[2] === "on";

const host = HostId.make("idle-host");

const workspaceId = WorkspaceId.make("idle-workspace");

const at = "2026-10-01T00:00:00.000Z";

const noop = Layer.succeed(ConstellationSessionEffects)({
  runTurn: () => Effect.void,
  canSteer: () => Effect.succeed(false),
  steer: () => Effect.void,
  retire: () => Effect.void,
  interrupt: () => Effect.void,
});

const layer = ConstellationDelivery.layer.pipe(
  Layer.provideMerge(EventStore.layerSqlite(join(home, "events.sqlite"))),
  Layer.provide(noop),
  Layer.provide(Layer.succeed(ConstellationOwner)(host))
);

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* EventStore;
      yield* store.commit({
        commandId: null,
        decide: () =>
          Effect.succeed([
            DomainEvent.cases.WorkspaceRegistered.make({
              workspace: new Workspace({
                id: workspaceId,
                path: home,
                name: "Idle",
                isGitRepo: false,
                worktreeRoot: join(home, "trees"),
                hidden: false,
                registeredAt: at,
              }),
            }),
            ...Array.from({ length: 128 }, (_, i) => {
              const sessionId = SessionId.make(`lead-${i}`);

              const constellation = new Constellation({
                id: ConstellationId.make(`graph-${i}`),
                workspaceId,
                hostId: host,
                leadSessionId: sessionId,
                name: `Graph ${i}`,
                state: "planning",
                revision: 0,
                settings: ConstellationSettings.make({}),
                tasks: [],
                attempts: [],
                pendingNotifications: [],
                createdAt: at,
                updatedAt: at,
              });

              return [
                DomainEvent.cases.SessionCreated.make({
                  session: new AgentSession({
                    id: sessionId,
                    workspaceId,
                    harness: "codex",
                    title: `Lead ${i}`,
                    cwd: home,
                    worktreeId: null,
                    state: "dormant",
                    permissionMode: "supervised",
                    model: "gpt-6.1-sol",
                    effort: "high",
                    parentSessionId: null,
                    forkedFromTurnId: null,
                    harnessCursor: null,
                    turnCount: 0,
                    contextUsage: null,
                    lastError: null,
                    createdAt: at,
                    updatedAt: at,
                  }),
                }),
                DomainEvent.cases.ConstellationStarted.make({
                  constellationId: constellation.id,
                  revision: 0,
                  constellation,
                }),
              ];
            }).flat(),
          ]),
      });
      // Keep Bun parked on an I/O handle, like a Daemon; a pending top-level await alone is not an idle server.
      yield* Effect.acquireRelease(
        Effect.sync(() => Bun.listen({ unix: join(home, "idle.sock"), socket: { data() {} } })),
        (listener) => Effect.sync(() => listener.stop(true))
      );
      const delivery = yield* ConstellationDelivery;

      if (enabled) yield* delivery.start();
      Bun.gc(true);
      process.stdout.write(
        `${JSON.stringify({ ready: true, enabled, graphs: (yield* store.model).constellations.size, pendingTimers: yield* delivery.pendingTimers })}\n`
      );
      yield* Effect.never;
    })
  ).pipe(Effect.provide(layer))
);
