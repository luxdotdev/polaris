import { join } from "node:path";
import { AgentSession, HostStreamItem, Sequence, constellationSummaryOf } from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Stream } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { loadHostInfo } from "../../transport/hostInfo.ts";
import { startServer } from "../../transport/server.ts";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { ConstellationDefaultsPath } from "../defaults.ts";
import { Constellations } from "../service.ts";
import {
  ConstellationOwner,
  ConstellationRuntime,
  type ConstellationRuntimeService,
} from "../runtime.ts";
import { ConstellationStatsService } from "../stats/index.ts";
import { ConstellationRpcHandlers } from "../rpc.ts";
import {
  ConstellationTransferHandlers,
  ConstellationTransferRoot,
  constellationTransfersLayer,
  TransferStorage,
  ConstellationOutbox,
  ConstellationBranchStatus,
  RemoteAssignments,
  RemotePlacements,
  RemoteWorkers,
  RemoteWorkerDelivery,
  RemoteDeliveries,
  type RemoteWorkerHooks,
} from "./index.ts";
import { ConstellationWorktrees } from "../worktrees.ts";
import { AT, LEAD, WS } from "../../engine/constellation.testing.ts";
import { connectRpc } from "../../../../../packages/client/src/rpc.ts";
import { socketTransport } from "../../../../../packages/client/src/transport.ts";
import type { LiveSession } from "../../../../../packages/client/src/HostConnection.ts";

export const fixtureSession = (cwd: string) =>
  AgentSession.make({
    id: LEAD,
    workspaceId: WS,
    harness: "codex",
    title: "Lead",
    cwd,
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

export const testIdentity = {
  name: "constellation-relay-test",
  version: "0.0.0",
  deviceLabel: "Test Client",
  capabilities: ["blobs", "constellation"],
} satisfies import("../../../../../packages/client/src/HostConnection.ts").ClientIdentity;

export const fakeHost = Effect.fnUntraced(function* (
  root: string,
  options: {
    runtime?: ConstellationRuntimeService;
    workers?: RemoteWorkerHooks;
    delivery?: {
      apply: (
        packet: import("@polaris/protocol").RemoteDeliveryPacket
      ) => Effect.Effect<void, import("@polaris/protocol").ConstellationTransferError>;
    };
  } = {}
) {
  const host = yield* loadHostInfo(root);

  const references = Layer.mergeAll(
    Layer.succeed(ConstellationDefaultsPath)(join(root, "defaults.json")),
    Layer.succeed(ConstellationOwner)(host.hostId),
    Layer.succeed(ConstellationTransferRoot)(root),
    Layer.succeed(ConstellationRuntime)(
      options.runtime ?? Context.get(Context.empty(), ConstellationRuntime)
    ),
    Layer.succeed(RemoteWorkers)(options.workers ?? Context.get(Context.empty(), RemoteWorkers)),
    Layer.succeed(RemoteWorkerDelivery)(
      options.delivery ?? Context.get(Context.empty(), RemoteWorkerDelivery)
    )
  );

  const provided = constellationTransfersLayer(join(root, "transfers.sqlite")).pipe(
    Layer.provideMerge(EventStore.layerSqlite(join(root, "events.sqlite"))),
    Layer.provideMerge(references)
  );

  const services = yield* Layer.build(provided);
  const store = Context.get(services, EventStore);

  const graphsContext = yield* Layer.build(
    Constellations.layer.pipe(
      Layer.provide(Layer.succeedContext(services)),
      Layer.provide(Layer.succeed(ConstellationOwner)(host.hostId))
    )
  );

  const graphs = Context.get(graphsContext, Constellations);

  const hostFeed = ServerRpcs.toLayerHandler("subscribeHost", () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* store.subscribe({
          filter: (item) =>
            Predicate.isTagged(item, "Event") &&
            Predicate.isTagged(item.envelope.event, "ConstellationStarted"),
        });

        const model = yield* store.model;

        return Stream.concat(
          Stream.fromIterable([
            HostStreamItem.cases.Snapshot.make({
              sequence: Sequence.make(model.sequence),
              workspaces: [],
              worktrees: [],
              sessions: [],
              constellations: [...model.constellations.values()].map((r) =>
                constellationSummaryOf(r.graph)
              ),
            }),
            HostStreamItem.cases.Synchronized.make({ sequence: Sequence.make(model.sequence) }),
          ]),
          live.pipe(
            Stream.filter((item) => Predicate.isTagged(item, "Event")),
            Stream.map((item) => HostStreamItem.cases.Event.make({ envelope: item.envelope }))
          )
        );
      })
    )
  );

  const handlers = Layer.mergeAll(
    ConstellationTransferHandlers,
    ConstellationRpcHandlers,
    hostFeed
  ).pipe(
    Layer.provide(
      Layer.succeed(ConstellationStatsService)({
        get: () => Effect.die("Stats is outside the relay fixture"),
      })
    ),
    Layer.provide(Layer.succeedContext(Context.merge(services, graphsContext))),
    Layer.provide(Layer.succeed(ConstellationOwner)(host.hostId))
  );

  const server = yield* startServer({
    root,
    socketPath: join(root, "daemon.sock"),
    lockPath: join(root, "daemon.lock"),
    capabilities: ["constellation"],
    handlers,
  });

  return {
    host,
    server,
    store,
    graphs,
    storage: Context.get(services, TransferStorage),
    outbox: Context.get(services, ConstellationOutbox),
    worktrees: Context.get(services, ConstellationWorktrees),
    branches: Context.get(services, ConstellationBranchStatus),
    assignments: Context.get(services, RemoteAssignments),
    placements: Context.get(services, RemotePlacements),
    deliveries: Context.get(services, RemoteDeliveries),
  };
});

export const connectFake = Effect.fnUntraced(function* (
  socketPath: string
): Effect.fn.Return<
  LiveSession,
  | import("../../../../../packages/client/src/failures.ts").ConnectFailure
  | import("effect/rpc/RpcClientError").RpcClientError,
  import("effect").Scope.Scope
> {
  const rpc = yield* connectRpc(yield* socketTransport(socketPath));

  const hello = yield* rpc.client.hello({
    clientName: testIdentity.name,
    clientVersion: testIdentity.version,
    deviceLabel: testIdentity.deviceLabel,
    capabilities: testIdentity.capabilities,
  });

  return {
    host: hello.host,
    epoch: 1,
    client: rpc.client,
    blobs: rpc.blobs,
    capabilities: hello.capabilities,
  };
});
