import { Effect, Schema } from "effect";
import { Actor } from "../extensions.ts";
import { HostId, SessionId, TurnId, Timestamp } from "../ids.ts";
import { optionalNullable } from "../models.ts";
import {
  AttemptWaiting,
  ConstellationCommand,
  MessageAuthority,
  MessageTarget,
} from "./commands.ts";
import {
  Attempt,
  HarnessSelection,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationFinding,
  ConstellationId,
  ConstellationNotification,
  ConstellationState,
  EvidenceTier,
  FailureKind,
  HostResource,
  ResourceLease,
  Revision,
  StallAudit,
  Task,
  TaskDefinition,
  TaskId,
} from "./domain.ts";
import { InspectionRoute, InspectionVerdict, LogbookNoteAuthor } from "./logbook.ts";

/** A boolean added after logs were written: absent decodes and constructs as false. */
const addedFalse = Schema.Boolean.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(false)),
  Schema.withConstructorDefault(Effect.succeed(false))
);

const graph = { constellationId: ConstellationId, revision: Revision };

const attempt = { ...graph, attemptId: AttemptId, attemptRevision: Revision };

const task = { ...graph, taskId: TaskId, taskRevision: Revision };

/** Field sets shared with DomainEvent so persisted and streamed events use one codec. */
export const constellationEventFields = {
  ConstellationStarted: { ...graph, constellation: Schema.suspend(() => Constellation) },
  ConstellationStateChanged: { ...graph, state: ConstellationState },
  LeadHandoverRequested: {
    ...graph,
    requestId: Schema.String,
    from: SessionId,
    summary: Schema.String,
    interrupt: Schema.Boolean,
    selection: optionalNullable(Schema.suspend(() => HarnessSelection)),
  },
  LeadHandoverCancelled: { ...graph, requestId: Schema.String, reason: Schema.String },
  LeadChanged: {
    ...graph,
    from: SessionId,
    to: SessionId,
    summary: Schema.String,
    requestId: optionalNullable(Schema.String),
  },
  TaskDeclared: { ...graph, task: Schema.suspend(() => Task) },
  TaskEdited: { ...graph, task: Schema.suspend(() => Task) },
  TaskCanceled: task,
  TaskProposed: {
    ...graph,
    proposalId: Schema.String,
    by: AttemptId,
    task: Schema.suspend(() => TaskDefinition),
  },
  ProposalAccepted: { ...graph, proposalId: Schema.String, task: Schema.suspend(() => Task) },
  ProposalDeclined: { ...graph, proposalId: Schema.String, reason: Schema.String },
  /** `actor` on what the user does: a Teammate acting through a Share; null for the owner. */
  AttemptStarted: {
    ...graph,
    attempt: Schema.suspend(() => Attempt),
    actor: optionalNullable(Actor),
  },
  AttemptProgressed: {
    ...attempt,
    note: Schema.String,
    completed: optionalNullable(Revision),
    total: optionalNullable(Revision),
    waiting: optionalNullable(AttemptWaiting),
  },
  AttemptClaimed: { ...attempt, claim: Schema.suspend(() => Claim) },
  ClaimApproved: {
    ...attempt,
    by: Schema.Literal("user"),
    at: Timestamp,
    actor: optionalNullable(Actor),
  },
  ClaimHandedUp: { ...attempt, reason: optionalNullable(Schema.String), at: Timestamp },
  AttemptBlocked: {
    ...attempt,
    on: Schema.Array(TaskId),
    reason: Schema.NonEmptyString,
    at: Timestamp,
  },
  AttemptUnblocked: { ...attempt, cause: Schema.Literals(["Accepted", "Lead"]), at: Timestamp },
  AttemptNudged: { ...attempt, at: Timestamp },
  AttemptInterrupted: {
    ...graph,
    attemptId: AttemptId,
    turnId: TurnId,
    interruptionId: Schema.String,
    eligible: Schema.Boolean,
    at: Timestamp,
  },
  AttemptStale: { ...graph, attemptId: AttemptId, hostId: HostId, at: Timestamp },
  AttemptFresh: { ...graph, attemptId: AttemptId, at: Timestamp },
  AttemptAccepted: {
    ...attempt,
    mergedHead: Schema.String,
    receipts: Schema.Array(Schema.suspend(() => CheckReceipt)),
    evidence: EvidenceTier,
    /** Absent on events written before Accept recorded its merge's findings. */
    findings: Schema.optionalKey(Schema.Array(ConstellationFinding)),
  },
  /** `by` is null on events written before it was recorded. */
  AttemptRejected: {
    ...attempt,
    reason: Schema.String,
    by: optionalNullable(Schema.Literals(["user", "lead", "inspector"])),
    actor: optionalNullable(Actor),
  },
  /**
   * A Claim arrived on a Task marked for Inspection (ADR 0119): the Daemon starts `sessionId`
   * as its Inspector and holds the Claim from the Lead. `accept` is the Task's grant then.
   */
  InspectionStarted: {
    ...attempt,
    inspectionId: Schema.NonEmptyString,
    sessionId: SessionId,
    head: Schema.NonEmptyString,
    accept: Schema.Boolean,
    at: Timestamp,
  },
  /**
   * The Inspector's verdict and where it went. `mergeRefusal` is set when a granted Accept
   * could not merge, so the approval went to the Lead instead.
   */
  InspectionRecorded: {
    ...attempt,
    inspectionId: Schema.NonEmptyString,
    verdict: InspectionVerdict,
    route: InspectionRoute,
    reason: Schema.String,
    mergeRefusal: optionalNullable(Schema.String),
    at: Timestamp,
  },
  /**
   * An Inspection ended with no verdict: a new Claim or a review by the Lead or user superseded
   * it, or its Inspector was lost. A lost one releases the Claim to the Lead.
   */
  InspectionEnded: {
    ...attempt,
    inspectionId: Schema.NonEmptyString,
    cause: Schema.Literals(["claim", "review", "lost"]),
    reason: Schema.String,
    at: Timestamp,
  },
  AttemptSettled: {
    ...attempt,
    outcome: Schema.Literals(["lost", "failed"]),
    reason: Schema.String,
    /** Classified from the Harness failure; null for a commanded or lost settle. */
    failureKind: optionalNullable(FailureKind),
    /** A capacity failure's Plan Limit reset, when known. Nothing redispatches at it. */
    resetsAt: optionalNullable(Timestamp),
  },
  GatePromoted: task,
  NotificationQueued: { ...graph, notification: Schema.suspend(() => ConstellationNotification) },
  /** `steered` lands the digest in the Lead's working Turn; otherwise `turnId` is a new Turn. */
  LeadNotified: {
    ...graph,
    leadSessionId: SessionId,
    items: Schema.Array(Schema.String),
    turnId: TurnId,
    steered: addedFalse,
    /** A stall audit delivered with (or instead of) items; null when nothing stalled. */
    audit: optionalNullable(Schema.suspend(() => StallAudit)),
  },
  OperatorMessageSent: {
    ...graph,
    id: Schema.String,
    authority: MessageAuthority,
    target: Schema.suspend(() => MessageTarget),
    text: Schema.String,
    questionId: optionalNullable(Schema.String),
    actor: optionalNullable(Actor),
    /** Who sent it; null on events written before it was recorded. */
    by: optionalNullable(Schema.Literals(["user", "lead"])),
  },
  WorkerInputDelivered: { ...graph, id: Schema.String, sessionId: SessionId, at: Timestamp },
  OperatorMessageResolved: { ...graph, id: Schema.String },
  PeerMessage: { ...graph, from: AttemptId, to: AttemptId, text: Schema.String },
  /**
   * A note on a Task's Logbook (ADR 0119): record only, delivered to no one. `attemptId` is the
   * Task's latest Attempt when it was written, or null before the first.
   */
  LogbookNoted: {
    ...graph,
    id: Schema.NonEmptyString,
    taskId: TaskId,
    attemptId: Schema.NullOr(AttemptId),
    author: LogbookNoteAuthor,
    text: Schema.NonEmptyString,
    actor: optionalNullable(Actor),
  },
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
    ConstellationCommand.cases.WorkerBlock,
    ConstellationCommand.cases.WorkerClaim,
    ConstellationCommand.cases.WorkerAsk,
    ConstellationCommand.cases.WorkerProgress,
    ConstellationCommand.cases.WorkerPropose,
    ConstellationCommand.cases.WorkerMessage,
  ]),
}) {}
