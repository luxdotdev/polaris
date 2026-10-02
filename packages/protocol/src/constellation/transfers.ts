import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { WorkerPlacement } from "./commands.ts";
import { BlobId, SessionId, HostId } from "../ids.ts";
import { TurnItem } from "../domain.ts";
import {
  Attempt,
  AttemptId,
  Constellation,
  ConstellationId,
  TaskDefinition,
  ToolCallReference,
} from "./domain.ts";
import { ConstellationOutboxEntry } from "./events.ts";
import { ConstellationRejected, ConstellationResult } from "./rpc.ts";

export class ConstellationTransferError extends Schema.TaggedError<ConstellationTransferError>()(
  "ConstellationTransferError",
  { code: Schema.String, message: Schema.String, retryable: Schema.Boolean }
) {}

export class WorktreeRequest extends Schema.Class<WorktreeRequest>("ConstellationWorktreeRequest")({
  key: Schema.NonEmptyString,
  constellationId: ConstellationId,
  task: TaskDefinition,
  repoPath: Schema.NonEmptyString,
  leadPath: Schema.NullOr(Schema.String),
  branchPrefix: Schema.NonEmptyString,
  base: Schema.NullOr(Schema.String),
  worktree: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
}) {}

export class PreparedWorktree extends Schema.Class<PreparedWorktree>(
  "PreparedConstellationWorktree"
)({
  repoPath: Schema.String,
  worktree: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  managed: Schema.Boolean,
  managedBranch: Schema.Boolean,
}) {}

export class RemoteWorkerAssignment extends Schema.Class<RemoteWorkerAssignment>(
  "RemoteWorkerAssignment"
)({
  graph: Constellation,
  attemptId: AttemptId,
  repoPath: Schema.NonEmptyString,
}) {}

export const ClaimProbe = Schema.Struct({
  dirtyPaths: Schema.Array(Schema.String),
  branch: Schema.String,
  head: Schema.String,
});

export const RecordedRemoteCheck = Schema.Struct({ reference: ToolCallReference, item: TurnItem });

export class ConstellationOutboxPacket extends Schema.Class<ConstellationOutboxPacket>(
  "ConstellationOutboxPacket"
)({
  entry: ConstellationOutboxEntry,
  claimProbe: Schema.NullOr(ClaimProbe),
  recordedChecks: Schema.Array(RecordedRemoteCheck),
}) {}

export const ConstellationRelayReceipt = Schema.TaggedUnion({
  Applied: { id: Schema.String, result: ConstellationResult },
  Refused: { id: Schema.String, rejection: ConstellationRejected },
});

export type ConstellationRelayReceipt = typeof ConstellationRelayReceipt.Type;

export class RemotePlacementRequest extends Schema.Class<RemotePlacementRequest>(
  "RemotePlacementRequest"
)({
  id: Schema.NonEmptyString,
  graph: Constellation,
  task: TaskDefinition,
  worker: WorkerPlacement.cases.New,
  sessionId: Schema.NullOr(SessionId),
  previous: Schema.NullOr(Attempt),
  baseHead: Schema.NonEmptyString,
}) {}

export const RemotePlacementResponse = Schema.TaggedUnion({
  Prepared: { attempt: Attempt },
  Failed: { error: ConstellationTransferError },
});

export type RemotePlacementResponse = typeof RemotePlacementResponse.Type;

const error = ConstellationTransferError;

export const ConstellationWorktreePrepare = Rpc.make("constellation.worktree.prepare", {
  payload: { request: WorktreeRequest },
  success: PreparedWorktree,
  error,
});

export const ConstellationBundleExport = Rpc.make("constellation.bundle.export", {
  payload: { repoPath: Schema.String, head: Schema.String },
  success: Schema.Struct({ head: Schema.String, ref: Schema.String, blobId: BlobId }),
  error,
});

export const ConstellationBundleImport = Rpc.make("constellation.bundle.import", {
  payload: {
    repoPath: Schema.String,
    head: Schema.String,
    ref: Schema.String,
    blobId: BlobId,
    constellationId: ConstellationId,
    attemptId: Schema.NullOr(AttemptId),
  },
  success: Schema.Struct({ head: Schema.String }),
  error,
});

export const ConstellationAssignmentSet = Rpc.make("constellation.assignment.set", {
  payload: { assignment: RemoteWorkerAssignment },
  success: Schema.Void,
  error,
});

export const ConstellationAssignmentList = Rpc.make("constellation.assignment.list", {
  payload: {},
  success: Schema.Array(RemoteWorkerAssignment),
  error,
});

export const ConstellationOutboxWatch = Rpc.make("constellation.outbox.watch", {
  payload: {},
  success: Schema.Array(ConstellationOutboxPacket),
  error,
  stream: true,
});

export const ConstellationOutboxApply = Rpc.make("constellation.outbox.apply", {
  payload: { packet: ConstellationOutboxPacket },
  success: ConstellationRelayReceipt,
  error,
});

export const ConstellationOutboxAck = Rpc.make("constellation.outbox.ack", {
  payload: { receipt: ConstellationRelayReceipt },
  success: Schema.Void,
  error,
});

export const ConstellationClaimExport = Rpc.make("constellation.claim.export", {
  payload: { constellationId: ConstellationId, attemptId: AttemptId, head: Schema.String },
  success: Schema.Struct({
    head: Schema.String,
    ref: Schema.String,
    blobId: Schema.NullOr(BlobId),
    branch: Schema.String,
    origin: Schema.NullOr(Schema.String),
    transfer: Schema.Literals(["bundle", "origin"]),
  }),
  error,
});

export const ConstellationOriginImport = Rpc.make("constellation.origin.import", {
  payload: {
    constellationId: ConstellationId,
    attemptId: AttemptId,
    head: Schema.String,
    branch: Schema.String,
  },
  success: Schema.Struct({ head: Schema.String }),
  error,
});

export const ConstellationBaseExport = Rpc.make("constellation.base.export", {
  payload: { constellationId: ConstellationId, head: Schema.String },
  success: ConstellationClaimExport.successSchema,
  error,
});

export const ConstellationBaseImport = Rpc.make("constellation.base.import", {
  payload: {
    graph: Constellation,
    repoPath: Schema.String,
    head: Schema.String,
    ref: Schema.String,
    branch: Schema.String,
    origin: Schema.NullOr(Schema.String),
    blobId: Schema.NullOr(BlobId),
  },
  success: Schema.Struct({ head: Schema.String }),
  error,
});

export const RemoteDeliveryInput = Schema.TaggedUnion({
  Turn: { text: Schema.String, cause: Schema.String },
  Steer: { text: Schema.String },
});

export class RemoteDeliveryPacket extends Schema.Class<RemoteDeliveryPacket>(
  "RemoteDeliveryPacket"
)({
  id: Schema.NonEmptyString,
  constellationId: ConstellationId,
  attemptId: AttemptId,
  ownerHostId: HostId,
  workerHostId: HostId,
  sessionId: SessionId,
  input: RemoteDeliveryInput,
}) {}

export class RemoteDeliveryReceipt extends Schema.Class<RemoteDeliveryReceipt>(
  "RemoteDeliveryReceipt"
)({
  id: Schema.String,
  packetHash: Schema.String,
}) {}

export const ConstellationDeliveryWatch = Rpc.make("constellation.delivery.watch", {
  payload: {},
  success: Schema.Array(RemoteDeliveryPacket),
  error,
  stream: true,
});

export const ConstellationDeliveryApply = Rpc.make("constellation.delivery.apply", {
  payload: { packet: RemoteDeliveryPacket },
  success: RemoteDeliveryReceipt,
  error,
});

export const ConstellationDeliveryAck = Rpc.make("constellation.delivery.ack", {
  payload: { receipt: RemoteDeliveryReceipt },
  success: Schema.Void,
  error,
});

export const ConstellationPlacementsWatch = Rpc.make("constellation.placements.watch", {
  payload: {},
  success: Schema.Array(RemotePlacementRequest),
  error,
  stream: true,
});

export const ConstellationPlacementResolve = Rpc.make("constellation.placement.resolve", {
  payload: { id: Schema.String, response: RemotePlacementResponse },
  success: Schema.Void,
  error,
});

export const ConstellationRepositoryPrepare = Rpc.make("constellation.repository.prepare", {
  payload: { request: RemotePlacementRequest },
  success: Schema.Struct({ repoPath: Schema.String }),
  error,
});

export const ConstellationWorkerPrepare = Rpc.make("constellation.worker.prepare", {
  payload: { request: RemotePlacementRequest, prepared: PreparedWorktree },
  success: Attempt,
  error,
});

export class ConstellationTransferRpcs extends RpcGroup.make(
  ConstellationWorktreePrepare,
  ConstellationBundleExport,
  ConstellationBundleImport,
  ConstellationAssignmentSet,
  ConstellationAssignmentList,
  ConstellationOutboxWatch,
  ConstellationOutboxApply,
  ConstellationOutboxAck,
  ConstellationClaimExport,
  ConstellationOriginImport,
  ConstellationBaseExport,
  ConstellationBaseImport,
  ConstellationDeliveryWatch,
  ConstellationDeliveryApply,
  ConstellationDeliveryAck,
  ConstellationPlacementsWatch,
  ConstellationPlacementResolve,
  ConstellationRepositoryPrepare,
  ConstellationWorkerPrepare
) {}
