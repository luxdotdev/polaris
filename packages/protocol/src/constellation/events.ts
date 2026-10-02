import { Schema } from "effect";
import { HostId, SessionId, TurnId, Timestamp } from "../ids.ts";
import { optionalNullable } from "../models.ts";
import { ConstellationCommand, MessageAuthority, MessageTarget } from "./commands.ts";
import {
  Attempt,
  HarnessSelection,
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
  LeadHandoverRequested: {
    ...graph,
    requestId: Schema.String,
    from: SessionId,
    summary: Schema.String,
    interrupt: Schema.Boolean,
    selection: optionalNullable(HarnessSelection),
  },
  LeadHandoverCancelled: { ...graph, requestId: Schema.String, reason: Schema.String },
  LeadChanged: {
    ...graph,
    from: SessionId,
    to: SessionId,
    summary: Schema.String,
    requestId: optionalNullable(Schema.String),
  },
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
  ClaimApproved: { ...attempt, by: Schema.Literal("user"), at: Timestamp },
  ClaimHandedUp: { ...attempt, reason: optionalNullable(Schema.String), at: Timestamp },
  AttemptNudged: { ...attempt, at: Timestamp },
  AttemptStale: { ...graph, attemptId: AttemptId, hostId: HostId, at: Timestamp },
  AttemptFresh: { ...graph, attemptId: AttemptId, at: Timestamp },
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
  WorkerInputDelivered: { ...graph, id: Schema.String, sessionId: SessionId, at: Timestamp },
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
  ResourceRemoved: { hostId: HostId, resource: Schema.String },
  ResourceLeaseCanceled: {
    hostId: HostId,
    resource: Schema.String,
    requestId: Schema.String,
    reason: Schema.String,
  },
  ResourceLeaseQueued: {
    hostId: HostId,
    resource: Schema.String,
    requestId: Schema.String,
    sessionId: optionalNullable(SessionId),
    processId: Schema.optionalKey(Schema.Int),
    processIdentity: Schema.optionalKey(Schema.String),
    command: Schema.optionalKey(Schema.Array(Schema.String)),
    attemptId: optionalNullable(AttemptId),
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
