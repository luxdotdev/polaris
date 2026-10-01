import { Schema } from "effect";
import { HostId, SessionId, TurnId } from "../ids.ts";
import { optionalNullable } from "../models.ts";
import { ConstellationCommand, MessageAuthority, MessageTarget } from "./commands.ts";
import {
  Attempt,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationNotification,
  ConstellationState,
  EvidenceTier,
  HostResource,
  ResourceLease,
  Revision,
  Task,
  TaskDefinition,
  TaskId,
} from "./domain.ts";

const graph = { constellationId: ConstellationId, revision: Revision };

const attempt = { ...graph, attemptId: AttemptId, attemptRevision: Revision };

const task = { ...graph, taskId: TaskId, taskRevision: Revision };

/** Field sets shared with DomainEvent so persisted and streamed events use one codec. */
export const constellationEventFields = {
  ConstellationStarted: { ...graph, constellation: Constellation },
  ConstellationStateChanged: { ...graph, state: ConstellationState },
  LeadChanged: { ...graph, from: SessionId, to: SessionId, summary: Schema.String },
  TaskDeclared: { ...graph, task: Task },
  TaskEdited: { ...graph, task: Task },
  TaskCanceled: task,
  TaskProposed: { ...graph, proposalId: Schema.String, by: AttemptId, task: TaskDefinition },
  ProposalAccepted: { ...graph, proposalId: Schema.String, task: Task },
  ProposalDeclined: { ...graph, proposalId: Schema.String, reason: Schema.String },
  AttemptStarted: { ...graph, attempt: Attempt },
  AttemptProgressed: {
    ...attempt,
    note: Schema.String,
    completed: optionalNullable(Revision),
    total: optionalNullable(Revision),
  },
  AttemptClaimed: { ...attempt, claim: Claim },
  AttemptAccepted: {
    ...attempt,
    mergedHead: Schema.String,
    receipts: Schema.Array(CheckReceipt),
    evidence: EvidenceTier,
  },
  AttemptRejected: { ...attempt, reason: Schema.String },
  AttemptSettled: {
    ...attempt,
    outcome: Schema.Literals(["lost", "settled_unverified", "failed"]),
    reason: Schema.String,
  },
  GatePromoted: task,
  NotificationQueued: { ...graph, notification: ConstellationNotification },
  LeadNotified: {
    ...graph,
    leadSessionId: SessionId,
    items: Schema.Array(Schema.String),
    turnId: TurnId,
  },
  OperatorMessageSent: {
    ...graph,
    id: Schema.String,
    authority: MessageAuthority,
    target: MessageTarget,
    text: Schema.String,
    questionId: optionalNullable(Schema.String),
  },
  OperatorMessageResolved: { ...graph, id: Schema.String },
  PeerMessage: { ...graph, from: AttemptId, to: AttemptId, text: Schema.String },
  /** Journal the single automatic Continue; replay consumes its durable marker. */
  AttemptRecoveryContinued: {
    ...attempt,
    turnId: TurnId,
    interruptionId: Schema.String,
    cause: Schema.Literal("recover"),
  },
};

export const ConstellationEvent = Schema.TaggedUnion(constellationEventFields);

export type ConstellationEvent = typeof ConstellationEvent.Type;

export const resourceEventFields = {
  ResourceDeclared: { resource: HostResource },
  ResourceLeaseQueued: {
    hostId: HostId,
    resource: Schema.String,
    requestId: Schema.String,
    sessionId: optionalNullable(SessionId),
  },
  ResourceLeased: { lease: ResourceLease },
  ResourceReleased: {
    hostId: HostId,
    leaseId: Schema.String,
    resource: Schema.String,
    reason: Schema.String,
  },
};

export const ResourceEvent = Schema.TaggedUnion(resourceEventFields);

export type ResourceEvent = typeof ResourceEvent.Type;

/** Durable remote requests retain their id when the Desktop App retries delivery. */
export class ConstellationOutboxEntry extends Schema.Class<ConstellationOutboxEntry>(
  "ConstellationOutboxEntry"
)({
  id: Schema.NonEmptyString,
  constellationId: ConstellationId,
  ownerHostId: HostId,
  workerHostId: HostId,
  sessionId: SessionId,
  attemptId: AttemptId,
  command: Schema.Union([
    ConstellationCommand.cases.WorkerClaim,
    ConstellationCommand.cases.WorkerAsk,
    ConstellationCommand.cases.WorkerProgress,
    ConstellationCommand.cases.WorkerPropose,
    ConstellationCommand.cases.WorkerMessage,
  ]),
}) {}
