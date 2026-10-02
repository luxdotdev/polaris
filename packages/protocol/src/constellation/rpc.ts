import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CommandId, Sequence, HostId } from "../ids.ts";
import { optionalArray, optionalNullable } from "../models.ts";
import { ConstellationEvent } from "./events.ts";
import {
  AttemptProgress,
  ConstellationDigest,
  ConstellationHandover,
  ConstellationProposal,
  PendingOperatorMessage,
} from "./journal.ts";
import { ConstellationCommand } from "./commands.ts";
import {
  Constellation,
  AttemptId,
  ConstellationFinding,
  ConstellationGraphSlice,
  ConstellationId,
  ConstellationSettings,
  Revision,
  TaskProjection,
} from "./domain.ts";
import { WorkerLiveness } from "./liveness.ts";
import { ConstellationStats } from "./stats.ts";

export class ConstellationResult extends Schema.Class<ConstellationResult>("ConstellationResult")({
  summary: Schema.String,
  next: Schema.String,
  revision: Revision,
  sequence: Schema.NullOr(Sequence),
  constellation: optionalNullable(Constellation),
  projections: optionalArray(TaskProjection),
}) {}

export class ConstellationRejected extends Schema.TaggedError<ConstellationRejected>()(
  "ConstellationRejected",
  {
    findings: Schema.Array(ConstellationFinding),
    graph: Schema.NullOr(ConstellationGraphSlice),
    revision: Revision,
  }
) {}

const C = ConstellationCommand.cases;

const commandFields = <F extends Schema.Struct.Fields & { readonly _tag: Schema.Top }>(
  fields: F
) => {
  const { _tag, ...payload } = fields;

  return payload;
};

const mutation = {
  success: ConstellationResult,
  error: ConstellationRejected,
};

export const ConstellationPlan = Rpc.make("constellation.plan", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.Plan.fields) },
});

export const ConstellationDispatch = Rpc.make("constellation.dispatch", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.Dispatch.fields) },
});

export const ConstellationReview = Rpc.make("constellation.review", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.Review.fields) },
});

export const ConstellationAnswer = Rpc.make("constellation.answer", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.Answer.fields) },
});

export const ConstellationMessage = Rpc.make("constellation.message", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.Message.fields) },
});

export const ConstellationSetState = Rpc.make("constellation.set_state", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.SetState.fields) },
});

export const ConstellationWorkerClaim = Rpc.make("constellation.worker.claim", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.WorkerClaim.fields) },
});

export const ConstellationWorkerAsk = Rpc.make("constellation.worker.ask", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.WorkerAsk.fields) },
});

export const ConstellationWorkerProgress = Rpc.make("constellation.worker.progress", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.WorkerProgress.fields) },
});

export const ConstellationWorkerPropose = Rpc.make("constellation.worker.propose", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.WorkerPropose.fields) },
});

export const ConstellationWorkerMessage = Rpc.make("constellation.worker.message", {
  ...mutation,
  payload: { commandId: CommandId, ...commandFields(C.WorkerMessage.fields) },
});

/** Both roles use the same read-only outline; json requests include the folded graph. */
export const ConstellationStatus = Rpc.make("constellation.status", {
  ...mutation,
  payload: { constellationId: ConstellationId, json: Schema.optionalKey(Schema.Boolean) },
});

export const ConstellationStreamItem = Schema.TaggedUnion({
  /** Everything a fresh subscriber needs: the graph, its projections and the owner's journal. */
  Snapshot: {
    sequence: Sequence,
    constellation: Constellation,
    projections: Schema.Array(TaskProjection),
    proposals: Schema.Array(ConstellationProposal),
    progress: Schema.Array(AttemptProgress),
    messages: Schema.Array(PendingOperatorMessage),
    digests: Schema.Array(ConstellationDigest),
    handovers: Schema.Array(ConstellationHandover),
  },
  Event: {
    envelope: Schema.Struct({
      sequence: Sequence,
      occurredAt: Schema.String,
      commandId: Schema.NullOr(CommandId),
      event: ConstellationEvent,
    }),
  },
  Synchronized: { sequence: Sequence },
  BranchFetched: { attemptId: AttemptId, branchFetched: Schema.Boolean },
  /** Ephemeral and unsequenced: the latest observed liveness of one Attempt. */
  LivenessChanged: { attemptId: AttemptId, liveness: WorkerLiveness },
});

export type ConstellationStreamItem = typeof ConstellationStreamItem.Type;

export const SubscribeConstellation = Rpc.make("constellation.subscribe", {
  payload: { constellationId: ConstellationId, afterSequence: Schema.NullOr(Sequence) },
  success: ConstellationStreamItem,
  error: ConstellationRejected,
  stream: true,
});

export const ConstellationDefaultsGet = Rpc.make("constellation.defaults.get", {
  payload: {},
  success: Schema.Struct({ settings: ConstellationSettings }),
  error: ConstellationRejected,
});

export const ConstellationDefaultsSet = Rpc.make("constellation.defaults.set", {
  payload: { settings: ConstellationSettings },
  success: Schema.Struct({ settings: ConstellationSettings }),
  error: ConstellationRejected,
});

export const GetConstellationStats = Rpc.make("constellation.stats", {
  payload: { constellationId: ConstellationId },
  success: ConstellationStats,
  error: ConstellationRejected,
});

/** Trusted Desktop observation of the existing Host Connection State. */
export const ObserveConstellationConnection = Rpc.make("constellation.connection", {
  payload: { hostId: HostId, offline: Schema.Boolean },
  success: Schema.Void,
  error: ConstellationRejected,
});

export class ConstellationRpcs extends RpcGroup.make(
  ObserveConstellationConnection,
  GetConstellationStats,
  ConstellationDefaultsGet,
  ConstellationDefaultsSet,
  ConstellationPlan,
  ConstellationDispatch,
  ConstellationReview,
  ConstellationAnswer,
  ConstellationMessage,
  ConstellationStatus,
  ConstellationSetState,
  ConstellationWorkerClaim,
  ConstellationWorkerAsk,
  ConstellationWorkerProgress,
  ConstellationWorkerPropose,
  ConstellationWorkerMessage,
  SubscribeConstellation
) {}
