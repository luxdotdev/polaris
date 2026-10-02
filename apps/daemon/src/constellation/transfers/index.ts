import { Layer } from "effect";
import { TransferStorage } from "./storage.ts";
import { ConstellationWorktrees } from "../worktrees.ts";
import { ConstellationOutbox } from "./outbox.ts";
import { ConstellationBranchStatus } from "./branches.ts";
import { RemotePlacements } from "./placements.ts";
import { RemoteDeliveries } from "./delivery.ts";
import { RemoteAssignments } from "./assignments.ts";

/** Build once per Host before constructing Runtime.prepare and the remote Session hooks. */
export const constellationGitLayer = (path: string) =>
  Layer.mergeAll(
    ConstellationWorktrees.layer,
    ConstellationBranchStatus.layer,
    RemotePlacements.layer
  ).pipe(Layer.provideMerge(TransferStorage.layer(path)));

/** Provide the captured final Runtime and RemoteWorkers after preparation services are built. */
export const constellationRelayLayer = Layer.mergeAll(
  ConstellationOutbox.layer,
  RemoteAssignments.layer,
  RemoteDeliveries.layer
);

export const constellationTransfersLayer = (path: string) =>
  constellationRelayLayer.pipe(Layer.provideMerge(constellationGitLayer(path)));

export { TransferStorage } from "./storage.ts";

export { ConstellationOutbox } from "./outbox.ts";

export { ConstellationBranchStatus } from "./branches.ts";

export { RemotePlacements } from "./placements.ts";

export { RemoteAssignments, RemoteWorkers, type RemoteWorkerHooks } from "./assignments.ts";

export { ConstellationTransferHandlers, ConstellationTransferRoot } from "./rpc.ts";

export {
  prepareWorkerAttempts,
  type WorkerPreparation,
  type WorkerPreparationHooks,
} from "./prepareWorkers.ts";

export { withWorktreePreparation } from "./preparation.ts";

export { withRemoteWorkerCommands } from "./commands.ts";

export { remoteWorkingAttemptsLayer, type RemoteWorkingHooks } from "./remoteWorking.ts";

export { RemoteDeliveries, RemoteWorkerDelivery } from "./delivery.ts";

export { cleanupConstellationWorktrees } from "./cleanup.ts";
