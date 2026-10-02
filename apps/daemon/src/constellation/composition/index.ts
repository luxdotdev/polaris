import {
  type Attempt,
  CommandId,
  CommandRejected,
  ConstellationTransferError,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { mcpHttp } from "../../mcp/http.ts";
import { hostWorkingAttemptsLayer } from "../host.ts";
import {
  ConstellationOwner,
  ConstellationRuntime,
  type ConstellationRuntimeService,
} from "../runtime.ts";
import { Constellations } from "../service.ts";
import { withHandoverPreparation } from "../handover/index.ts";
import {
  ConstellationDelivery,
  ConstellationRemoteDelivery,
  applyWorkerDelivery,
} from "../delivery/index.ts";
import { engineDeliveryLayer } from "../delivery/engine.ts";
import { startConstellationDelivery } from "../delivery/startup.ts";
import {
  constellationRelayLayer,
  prepareWorkerAttempts,
  remoteWorkingAttemptsLayer,
  RemoteAssignments,
  RemoteDeliveries,
  RemoteWorkerDelivery,
  TransferStorage,
  withRemoteWorkerCommands,
  withWorktreePreparation,
} from "../transfers/index.ts";
import { HarnessRegistry } from "../../services.ts";
import { prepareSession } from "./prepare.ts";
import { startAttempt, resumeAttempt, workerFailed } from "./workers.ts";
import { ConstellationHarness } from "./attachments.ts";
import { attachmentProvider } from "./provider.ts";
import { ConstellationRpcHandlers } from "../rpc.ts";
import { ConstellationTransferHandlers, ConstellationTransferRoot } from "../transfers/rpc.ts";
import { constellationGitLayer } from "../transfers/index.ts";
import { ConstellationLiveness } from "../liveness.ts";
import { ConstellationStatsService } from "../stats/index.ts";
import { McpTokens } from "../../mcp/tokens.ts";
import { loadHostInfo } from "../../transport/hostInfo.ts";
import { constellationTransferPath } from "./startup.ts";

const localRuntime = Layer.unwrap(
  Effect.gen(function* () {
    const owner = yield* ConstellationOwner;
    const store = yield* EventStore;

    const context = yield* Effect.context<
      | EventStore
      | import("../../services.ts").HarnessRegistry
      | import("../worktrees.ts").ConstellationWorktrees
      | import("../transfers/placements.ts").RemotePlacements
    >();

    const runtime: ConstellationRuntimeService = withHandoverPreparation({
      prepare: (_binding, command, model, id) =>
        prepareWorkerAttempts(command, model, id, {
          defaultWorker: (graph) => WorkerPlacement.cases.New.make({ hostId: graph.hostId }),
          prepareSession: (input) => prepareSession(input, owner),
        }).pipe(
          Effect.provide(context),
          Effect.map((attempts) => ({
            attempts,
            newLeadSessionId: null,
            claimProbe: null,
            recordedChecks: [],
          }))
        ),
      resumeWorking: () => Effect.void,
      afterCommit: () => Effect.void,
    });

    return hostWorkingAttemptsLayer({
      runtime,
      startWorker: Effect.fnUntraced(function* (attempt: Attempt) {
        const graph = [...(yield* store.model).constellations.values()].find((r) =>
          r.graph.attempts.some((a) => a.id === attempt.id)
        )?.graph;

        if (graph !== undefined) yield* startAttempt(graph, attempt);
      }),
      resumeWorker: resumeAttempt,
      failed: workerFailed,
    });
  })
);

const runtime = Layer.effect(
  ConstellationRuntime,
  Effect.gen(function* () {
    return yield* withWorktreePreparation(yield* ConstellationRuntime);
  })
).pipe(Layer.provideMerge(localRuntime));

const remoteWorkers = Layer.unwrap(
  Effect.gen(function* () {
    const registry = yield* HarnessRegistry;
    const owner = yield* ConstellationOwner;
    const store = yield* EventStore;

    return remoteWorkingAttemptsLayer({
      prepare: (request, worktree) =>
        prepareSession(
          {
            key: request.id,
            graph: request.graph,
            task: request.task,
            worktree,
            placement:
              request.sessionId === null
                ? request.worker
                : WorkerPlacement.cases.Existing.make({ sessionId: request.sessionId }),
            previous: request.previous,
          },
          owner
        ).pipe(
          Effect.provideService(EventStore, store),
          Effect.provideService(HarnessRegistry, registry),
          Effect.mapError(
            (error) =>
              new ConstellationTransferError({
                code: "E-SESSION",
                message: error.findings.map((f) => f.message).join("; "),
                retryable: false,
              })
          )
        ),
      start: (assignment) => {
        const attempt = assignment.graph.attempts.find((a) => a.id === assignment.attemptId);

        return attempt === undefined ? Effect.void : startAttempt(assignment.graph, attempt);
      },
      // Remote recovery waits for verified worker interruption/continued-Turn receipts.
      resume: () => Effect.void,
      failed: workerFailed,
    });
  })
);

const workerDelivery = Layer.effect(
  RemoteWorkerDelivery,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      EventStore | import("../delivery/inputs.ts").ConstellationSessionEffects
    >();

    const storage = yield* TransferStorage;

    return {
      apply: (packet: import("@polaris/protocol").RemoteDeliveryPacket) =>
        applyWorkerDelivery(packet, (_packet, model) =>
          Effect.gen(function* () {
            const assignment = (yield* storage.assignments.pipe(Effect.orDie)).find(
              (a) =>
                a.attemptId === packet.attemptId &&
                a.graph.id === packet.constellationId &&
                a.graph.hostId === packet.ownerHostId
            );

            const attempt = assignment?.graph.attempts.find((a) => a.id === packet.attemptId);

            if (
              attempt?.sessionId !== packet.sessionId ||
              attempt.hostId !== packet.workerHostId ||
              attempt.state !== "working" ||
              assignment?.graph.state === "archived" ||
              !model.sessions.has(packet.sessionId)
            )
              return yield* new CommandRejected({
                commandId: CommandId.make(packet.id),
                reason: "The input is not for an active remote worker",
              });
          })
        ).pipe(
          Effect.provide(context),
          Effect.mapError(
            (error) =>
              new ConstellationTransferError({
                code: "E-DELIVERY",
                message: error.message,
                retryable: false,
              })
          )
        ),
    };
  })
);

const relay = constellationRelayLayer.pipe(
  Layer.provideMerge(
    Constellations.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(runtime, remoteWorkers, workerDelivery))
    )
  )
);

const remoteDelivery = Layer.effect(
  ConstellationRemoteDelivery,
  Effect.gen(function* () {
    const deliveries = yield* RemoteDeliveries;

    return { send: (packet) => deliveries.send(packet).pipe(Effect.orDie) };
  })
);

const delivery = ConstellationDelivery.layer.pipe(
  Layer.provideMerge(remoteDelivery),
  Layer.provideMerge(relay)
);

/** All callbacks are captured before worker replay; no first Turn is submitted on resume. */
export const constellationServices = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* withRemoteWorkerCommands(yield* Constellations);
    const endpoint = yield* mcpHttp(commands);
    yield* (yield* ConstellationHarness).install(endpoint.origin, commands);
    const assignments = yield* RemoteAssignments;
    const deliveries = yield* RemoteDeliveries;
    yield* startConstellationDelivery({
      runtime: yield* ConstellationRuntime,
      resumeRemote: assignments.resumeWorking().pipe(Effect.orDie),
      acknowledged: deliveries.acknowledged.pipe(Stream.orDie),
    });
  })
).pipe(
  Layer.provideMerge(delivery),
  Layer.provideMerge(engineDeliveryLayer),
  Layer.provideMerge(attachmentProvider)
);

/** Built once by the transport first-use loader using its existing Engine and base Context. */
export const constellationHandlers = (root: string) => {
  const owner = Layer.effect(
    ConstellationOwner,
    loadHostInfo(root).pipe(Effect.map((info) => info.hostId))
  );

  const base = Layer.mergeAll(
    constellationGitLayer(constellationTransferPath(root)),
    McpTokens.layer(`${root}/mcp.sqlite`),
    ConstellationLiveness.layer,
    Layer.succeed(ConstellationTransferRoot)(root)
  ).pipe(Layer.provideMerge(owner));

  return Layer.mergeAll(ConstellationRpcHandlers, ConstellationTransferHandlers).pipe(
    Layer.provide(
      Layer.mergeAll(ConstellationStatsService.layer, constellationServices).pipe(
        Layer.provideMerge(base)
      )
    )
  );
};
