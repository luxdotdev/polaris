/**
 * Persisted domain events. The Daemon's event store is the source of truth;
 * every read model a Client sees is a projection of these.
 */
import { Schema } from "effect";
import { constellationEventFields, resourceEventFields } from "./constellation/events.ts";
import { ConstellationId } from "./constellation/domain.ts";
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  ContextUsage,
  PermissionMode,
  SessionState,
  Subagent,
  Timestamp,
  Turn,
  TurnItem,
  Workspace,
  Worktree,
} from "./domain.ts";
import {
  CommandId,
  RequestId,
  ReviewCheckoutId,
  RiskFindingId,
  RiskSummaryId,
  Sequence,
  SessionId,
  SubagentId,
  TurnId,
  WorkspaceId,
  WorktreeId,
} from "./ids.ts";
import { WorktreeSetupRun } from "./worktreeSetup.ts";
import { addedNullable, ServiceTier, ModelId, ReasoningEffort } from "./models.ts";
import {
  FindingResolution,
  LayerRun,
  PullRequestRef,
  ReviewCheckout,
  ReviewCost,
  ReviewerRun,
  RiskFinding,
  RiskSummary,
  SummaryLayer,
  Walkthrough,
  Verdict,
} from "./review.ts";

export const DomainEvent = Schema.TaggedUnion({
  ...constellationEventFields,
  ...resourceEventFields,
  WorkspaceRegistered: { workspace: Workspace },
  WorkspaceUpdated: { workspace: Workspace },
  WorkspaceRemoved: { workspaceId: WorkspaceId },

  WorktreeDetected: { worktree: Worktree },
  WorktreeRemoved: { workspaceId: WorkspaceId, worktreeId: WorktreeId },

  SessionCreated: { session: AgentSession },
  SessionStateChanged: {
    sessionId: SessionId,
    state: SessionState,
    reason: Schema.NullOr(Schema.String),
  },
  SessionRenamed: { sessionId: SessionId, title: Schema.String },
  SessionCursorUpdated: { sessionId: SessionId, harnessCursor: Schema.String },
  SessionPermissionModeChanged: { sessionId: SessionId, permissionMode: PermissionMode },
  /** `SetModel`: the Model and effort the next Turns run on. */
  SessionModelChanged: {
    sessionId: SessionId,
    model: Schema.NullOr(ModelId),
    effort: Schema.NullOr(ReasoningEffort),
    serviceTier: Schema.optionalKey(Schema.NullOr(ServiceTier)),
  },

  /** The Harness reported how full the context window is (see `AgentSession.contextUsage`). */
  SessionSetupChanged: { sessionId: SessionId, setup: WorktreeSetupRun },
  SessionContextUsed: { sessionId: SessionId, usage: ContextUsage },

  TurnStarted: { turn: Turn },
  TurnItemCompleted: {
    sessionId: SessionId,
    turnId: TurnId,
    item: TurnItem,
    /** Set when the item is a Subagent's own, not the Turn's. */
    subagentId: addedNullable(SubagentId),
  },
  TurnEnded: { turn: Turn },

  /** A Harness spawned a Subagent in a Turn (capability `session.subagents`). */
  SubagentStarted: { subagent: Subagent },
  /** It finished, failed, or the Harness went away first (`interrupted`). */
  SubagentEnded: { subagent: Subagent },

  ApprovalRequested: { request: ApprovalRequest },
  ApprovalResolved: {
    sessionId: SessionId,
    requestId: RequestId,
    decision: ApprovalDecision,
    /** Label of the Client device that answered first. */
    resolvedBy: Schema.String,
  },
  /**
   * The request went away without a Client answering it: the Harness withdrew
   * it (the Turn ended or was interrupted, or the terminal UI answered it), or
   * the Daemon did (restart, crash, upgrade). Logs written before this event
   * existed record the same thing as `ApprovalResolved` with a `Deny` decision
   * and `resolvedBy` "Harness" or "Daemon"; both decode and project alike.
   */
  ApprovalWithdrawn: {
    sessionId: SessionId,
    requestId: RequestId,
    withdrawnBy: Schema.Literals(["harness", "daemon"]),
    reason: Schema.String,
  },

  CheckpointRecorded: {
    sessionId: SessionId,
    turnId: TurnId,
    ref: Schema.String,
    commit: Schema.String,
  },

  // ── Review (protocol README, "Review") ──

  /** `AcceptTurns`: the Turns through `throughIndex` are accepted (capability `session.accept`). */
  TurnsAccepted: {
    sessionId: SessionId,
    throughTurnId: TurnId,
    throughIndex: Schema.Int,
    revertLaterTurns: Schema.Boolean,
    /** Label of the Client device that accepted. */
    acceptedBy: Schema.String,
  },
  /** The working tree was restored to `toTurnId`'s after-checkpoint, undoing the Turns listed. */
  TurnsReverted: {
    sessionId: SessionId,
    toTurnId: TurnId,
    revertedTurnIds: Schema.Array(TurnId),
    checkpoint: Schema.String,
  },
  SessionPullRequestLinked: { sessionId: SessionId, pullRequest: PullRequestRef },

  /** Review Checkouts (capability `review.checkouts`): the whole checkout each time. */
  ReviewCheckoutOpened: { checkout: ReviewCheckout },
  ReviewCheckoutChanged: { checkout: ReviewCheckout },
  ReviewCheckoutRemoved: { checkoutId: ReviewCheckoutId, workspaceId: WorkspaceId },

  /**
   * Risk Summaries and Verdicts: review-only, left out of the Host stream and
   * served by `review.riskSummary` / `review.watchRiskSummary` / `review.verdicts`.
   */
  RiskSummaryStarted: { summary: RiskSummary },
  RiskSummaryLayerChanged: {
    summaryId: RiskSummaryId,
    layer: SummaryLayer,
    run: LayerRun,
    /** Walkthrough metadata does not change a Rules or Agent layer. */
    walkthrough: Schema.optionalKey(Walkthrough),
    deltaWalkthrough: Schema.optionalKey(Walkthrough),
  },
  /** Adds Findings, or replaces those with the same id (a Reviewer follow-up revising one). */
  RiskFindingsRecorded: { summaryId: RiskSummaryId, findings: Schema.Array(RiskFinding) },
  RiskFindingResolved: {
    summaryId: RiskSummaryId,
    findingId: RiskFindingId,
    resolution: FindingResolution,
    note: Schema.NullOr(Schema.String),
  },
  RiskSummaryEnded: {
    summaryId: RiskSummaryId,
    status: Schema.Literals(["completed", "failed"]),
    reviewer: Schema.NullOr(ReviewerRun),
    cost: Schema.NullOr(ReviewCost),
    note: Schema.NullOr(Schema.String),
  },
  VerdictRecorded: { verdict: Verdict },
});

export type DomainEvent = typeof DomainEvent.Type;

/** Which stream an event belongs to. Host-level events use `host`. */
export const StreamKey = Schema.TaggedUnion({
  host: {},
  session: { sessionId: SessionId },
  constellation: { constellationId: ConstellationId },
});

export type StreamKey = typeof StreamKey.Type;

export class EventEnvelope extends Schema.Class<EventEnvelope>("EventEnvelope")({
  sequence: Sequence,
  occurredAt: Timestamp,
  commandId: Schema.NullOr(CommandId),
  event: DomainEvent,
}) {}
