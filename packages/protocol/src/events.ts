/**
 * Persisted domain events. The Daemon's event store is the source of truth;
 * every read model a Client sees is a projection of these.
 */
import { Schema } from "effect";
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
  SessionState,
  Timestamp,
  Turn,
  TurnItem,
  Workspace,
  Worktree,
} from "./domain.ts";
import {
  CommandId,
  RequestId,
  Sequence,
  SessionId,
  TurnId,
  WorkspaceId,
  WorktreeId,
} from "./ids.ts";
import { ModelId, ReasoningEffort } from "./models.ts";

export const DomainEvent = Schema.TaggedUnion({
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
    model: ModelId,
    effort: Schema.NullOr(ReasoningEffort),
  },

  TurnStarted: { turn: Turn },
  TurnItemCompleted: { sessionId: SessionId, turnId: TurnId, item: TurnItem },
  TurnEnded: { turn: Turn },

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
});

export type DomainEvent = typeof DomainEvent.Type;

/** Which stream an event belongs to. Host-level events use `host`. */
export const StreamKey = Schema.Union([
  Schema.TaggedStruct("host", {}),
  Schema.TaggedStruct("session", { sessionId: SessionId }),
]);

export type StreamKey = typeof StreamKey.Type;

export class EventEnvelope extends Schema.Class<EventEnvelope>("EventEnvelope")({
  sequence: Sequence,
  occurredAt: Timestamp,
  commandId: Schema.NullOr(CommandId),
  event: DomainEvent,
}) {}
