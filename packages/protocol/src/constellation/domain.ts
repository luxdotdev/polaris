import { Schema } from "effect";
import { HarnessKind } from "../harnesses.ts";
import { HostId, SessionId, Timestamp, TurnId, WorkspaceId } from "../ids.ts";
import { ModelId, optionalArray, optionalNullable, ReasoningEffort } from "../models.ts";
import { WorkerLiveness } from "./liveness.ts";

export const ConstellationId = Schema.String.pipe(Schema.brand("ConstellationId"));

export type ConstellationId = typeof ConstellationId.Type;

export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"));

export type TaskId = typeof TaskId.Type;

export const AttemptId = Schema.String.pipe(Schema.brand("AttemptId"));

export type AttemptId = typeof AttemptId.Type;

export const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export type Revision = typeof Revision.Type;

export const ConstellationState = Schema.Literals([
  "planning",
  "running",
  "paused",
  "completed",
  "archived",
]);

export type ConstellationState = typeof ConstellationState.Type;

export const AttemptState = Schema.Literals([
  "working",
  "review",
  "accepted",
  "rejected",
  "lost",
  "settled_unverified",
  "failed",
]);

export type AttemptState = typeof AttemptState.Type;

export const TaskState = Schema.Literals([
  "future",
  "waiting",
  "ready",
  "working",
  "review",
  "done",
  "canceled",
  "lost",
  "settled_unverified",
  "failed",
]);

export type TaskState = typeof TaskState.Type;

export const EvidenceTier = Schema.Literals(["verified", "reported", "asserted"]);

export type EvidenceTier = typeof EvidenceTier.Type;

export const Area = Schema.Array(Schema.NonEmptyString);

export type Area = typeof Area.Type;

export class ConstellationFinding extends Schema.Class<ConstellationFinding>(
  "ConstellationFinding"
)({
  code: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  fix: Schema.NonEmptyString,
}) {}

export class HarnessSelection extends Schema.Class<HarnessSelection>("HarnessSelection")({
  harness: Schema.optionalKey(HarnessKind),
  model: Schema.optionalKey(ModelId),
  effort: Schema.optionalKey(ReasoningEffort),
}) {}

export class TaskDefinition extends Schema.Class<TaskDefinition>("TaskDefinition")({
  id: TaskId,
  title: Schema.NonEmptyString,
  kind: Schema.Literals(["task", "gate"]),
  deps: optionalArray(TaskId),
  area: optionalArray(Schema.NonEmptyString),
  brief: Schema.String,
  criteria: optionalArray(Schema.String),
  suggested: optionalNullable(HarnessSelection),
  group: optionalNullable(Schema.String),
}) {}

/** Task state and Gate readiness are derived from Attempts, never written here. */
export class Task extends Schema.Class<Task>("ConstellationTask")({
  ...TaskDefinition.fields,
  revision: Revision,
  canceled: Schema.Boolean,
}) {}

export const AttemptCause = Schema.TaggedUnion({
  Initial: {},
  SentBack: { ref: AttemptId },
  MergeConflict: { ref: AttemptId, base: Schema.NonEmptyString },
  Recover: { ref: AttemptId },
  Followup: { ref: AttemptId },
  Superseded: { ref: AttemptId },
});

export type AttemptCause = typeof AttemptCause.Type;

/** Verified receipts reference the persisted item; callers cannot supply its output as proof. */
export class ToolCallReference extends Schema.Class<ToolCallReference>("ToolCallReference")({
  hostId: HostId,
  sessionId: SessionId,
  turnId: TurnId,
  itemId: Schema.NonEmptyString,
}) {}

export const CheckReceipt = Schema.TaggedUnion({
  Verified: { label: Schema.NonEmptyString, item: ToolCallReference },
  Reported: {
    label: Schema.NonEmptyString,
    text: Schema.NonEmptyString,
    command: optionalNullable(Schema.String),
    exitCode: optionalNullable(Schema.Int),
  },
});

export type CheckReceipt = typeof CheckReceipt.Type;

export class ConstellationQuestion extends Schema.Class<ConstellationQuestion>(
  "ConstellationQuestion"
)({
  id: Schema.NonEmptyString,
  to: Schema.Literals(["lead", "user"]),
  text: Schema.NonEmptyString,
  blocking: Schema.Boolean,
}) {}

export class AreaException extends Schema.Class<AreaException>("AreaException")({
  path: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
}) {}

export class Claim extends Schema.Class<Claim>("ConstellationClaim")({
  branch: Schema.NonEmptyString,
  head: Schema.NonEmptyString,
  commits: Schema.Array(Schema.NonEmptyString),
  receipts: Schema.Array(CheckReceipt),
  notDone: Schema.Array(Schema.String),
  followups: Schema.Array(Schema.String),
  questions: Schema.Array(ConstellationQuestion),
  outsideArea: Schema.Array(AreaException),
  decisions: Schema.Array(Schema.String),
  summary: Schema.String,
}) {}

export class Attempt extends Schema.Class<Attempt>("ConstellationAttempt")({
  id: AttemptId,
  taskId: TaskId,
  revision: Revision,
  cause: AttemptCause,
  by: SessionId,
  sessionId: SessionId,
  hostId: HostId,
  worktree: Schema.NonEmptyString,
  branch: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  state: AttemptState,
  claim: optionalNullable(Claim),
  mergedHead: optionalNullable(Schema.String),
  receipts: optionalArray(CheckReceipt),
  evidence: optionalNullable(EvidenceTier),
  approvedByUserAt: optionalNullable(Timestamp),
  handedUpAt: optionalNullable(Timestamp),
  handedUpReason: optionalNullable(Schema.String),
  nudgedAt: optionalNullable(Timestamp),
  startedAt: Timestamp,
  endedAt: optionalNullable(Timestamp),
}) {}

export class ConstellationSettings extends Schema.Class<ConstellationSettings>(
  "ConstellationSettings"
)({
  branchPrefix: Schema.optionalKey(Schema.NonEmptyString),
  transfer: Schema.optionalKey(Schema.Literals(["bundle", "origin"])),
  defaults: optionalNullable(HarnessSelection),
  backend: optionalNullable(HarnessSelection),
  ui: optionalNullable(HarnessSelection),
  claimCoalescingMs: Schema.optionalKey(Revision),
  questionCoalescingMs: Schema.optionalKey(Revision),
}) {}

export const NotificationItem = Schema.TaggedUnion({
  Settled: { attemptId: AttemptId, state: AttemptState },
  Question: { attemptId: AttemptId, question: ConstellationQuestion },
  Proposal: { attemptId: AttemptId, proposalId: Schema.String },
  OperatorMessage: { messageId: Schema.String, text: Schema.String },
  QuestionAnswered: { attemptId: AttemptId, questionId: Schema.String, text: Schema.String },
});

export type NotificationItem = typeof NotificationItem.Type;

export class ConstellationNotification extends Schema.Class<ConstellationNotification>(
  "ConstellationNotification"
)({
  id: Schema.NonEmptyString,
  item: NotificationItem,
  queuedAt: Timestamp,
}) {}

export class Constellation extends Schema.Class<Constellation>("Constellation")({
  id: ConstellationId,
  workspaceId: WorkspaceId,
  hostId: HostId,
  leadSessionId: SessionId,
  name: Schema.NonEmptyString,
  state: ConstellationState,
  revision: Revision,
  settings: ConstellationSettings,
  tasks: Schema.Array(Task),
  attempts: Schema.Array(Attempt),
  pendingNotifications: optionalArray(ConstellationNotification),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

export class TaskProjection extends Schema.Class<TaskProjection>("ConstellationTaskProjection")({
  taskId: TaskId,
  state: TaskState,
  latestAttemptId: Schema.NullOr(AttemptId),
  blockedBy: Schema.Array(TaskId),
  gatePromoted: Schema.Boolean,
  stale: Schema.Boolean,
  branchFetched: Schema.Boolean,
  /** Optional/nullable on the wire; decoded projections use null for unavailable facts. */
  liveness: optionalNullable(WorkerLiveness),
}) {}

export class ConstellationGraphSlice extends Schema.Class<ConstellationGraphSlice>(
  "ConstellationGraphSlice"
)({
  constellationId: ConstellationId,
  revision: Revision,
  tasks: Schema.Array(Task),
  attempts: Schema.Array(Attempt),
  projections: optionalArray(TaskProjection),
}) {}

export class HostResource extends Schema.Class<HostResource>("HostResource")({
  hostId: HostId,
  name: Schema.NonEmptyString,
  capacity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  holdLimitMs: Schema.optionalKey(Revision),
}) {}

export class ResourceLease extends Schema.Class<ResourceLease>("ResourceLease")({
  id: Schema.NonEmptyString,
  hostId: HostId,
  resource: Schema.NonEmptyString,
  sessionId: optionalNullable(SessionId),
  attemptId: optionalNullable(AttemptId),
  command: Schema.Array(Schema.String),
  processId: Schema.Int,
  processIdentity: Schema.optionalKey(Schema.String),
  acquiredAt: Timestamp,
}) {}
