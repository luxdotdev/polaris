import {
  type Attempt,
  ConstellationTransferError,
  RemoteDeliveryPacket,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import { registerStartupGraphs } from "../../engine/sessionBoundary.ts";
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
import { WorktreeSetupService } from "../setup/index.ts";
import { prepareSession } from "./prepare.ts";
import {
  canStartAttempt,
  startAttempt,
  startPendingAttempt,
  resumeAttempt,
  workerFailed,
} from "./workers.ts";
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
import { validateRemoteDelivery } from "./remoteDelivery.ts";

export { StartupAbandoned } from "./startupAbandoned.ts";

const localRuntime = Layer.unwrap(
  Effect.gen(function* () {
    const owner = yield* ConstellationOwner;
    const store = yield* EventStore;

    const context = yield* Effect.context<
      | WorktreeSetupService
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
    const setup = yield* WorktreeSetupService;
    const storage = yield* TransferStorage;
    registerStartupGraphs(
      store,
      (sessionId) =>
        Effect.map(storage.assignmentsForSession(sessionId), (assignments) =>
          assignments.map((a) => a.graph)
        ),
      storage.assignmentChanges,
      (sessionId) => storage.hasAssignmentsForSession?.(sessionId) !== false
    );

    const currentAssignment = (assignment: import("@polaris/protocol").RemoteWorkerAssignment) =>
      Effect.map(storage.assignments.pipe(Effect.orDie), (assignments) => {
        const current = assignments.find((a) => a.attemptId === assignment.attemptId);
        const attempt = current?.graph.attempts.find((a) => a.id === assignment.attemptId);

        return (
          current !== undefined &&
          attempt !== undefined &&
          current.graph.revision >= assignment.graph.revision &&
          canStartAttempt(current.graph, attempt)
        );
      });

    return remoteWorkingAttemptsLayer({
      prepare: (request, worktree) =>
        prepareSession(
          {
            key: request.id,
            worktreeSetup: request.worktreeSetup,
            forceSetup: request.forceSetup === true,
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
          Effect.provideService(WorktreeSetupService, setup),
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

        return attempt === undefined
          ? Effect.void
          : startAttempt(assignment.graph, attempt, () => currentAssignment(assignment));
      },
      // Existing remote Turns still wait for verified interruption/continued-Turn receipts.
      resume: (assignment) => {
        const attempt = assignment.graph.attempts.find((a) => a.id === assignment.attemptId);

        return attempt === undefined
          ? Effect.void
          : startPendingAttempt(assignment.graph, attempt, () =>
              currentAssignment(assignment)
            ).pipe(Effect.asVoid);
      },
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
            yield* validateRemoteDelivery(
              packet,
              model,
              yield* storage.assignments.pipe(Effect.orDie)
            );
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

    return {
      send: (packet) => deliveries.send(RemoteDeliveryPacket.make(packet)).pipe(Effect.orDie),
    };
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
  Layer.provideMerge(attachmentProvider),
  Layer.provideMerge(WorktreeSetupService.layer)
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
