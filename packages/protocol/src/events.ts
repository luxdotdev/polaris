/**
 * Persisted domain events. The Daemon's event store is the source of truth;
 * every read model a Client sees is a projection of these.
 */
import { Schema } from "effect"
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  SessionState,
  Timestamp,
  Turn,
  TurnItem,
  Workspace,
  Worktree,
} from "./domain.ts"
import {
  CommandId,
  RequestId,
  Sequence,
  SessionId,
  TurnId,
  WorkspaceId,
  WorktreeId,
} from "./ids.ts"

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

  CheckpointRecorded: {
    sessionId: SessionId,
    turnId: TurnId,
    ref: Schema.String,
    commit: Schema.String,
  },
})
export type DomainEvent = typeof DomainEvent.Type

/** Which stream an event belongs to. Host-level events use `host`. */
export const StreamKey = Schema.Union([
  Schema.TaggedStruct("host", {}),
  Schema.TaggedStruct("session", { sessionId: SessionId }),
])
export type StreamKey = typeof StreamKey.Type

export class EventEnvelope extends Schema.Class<EventEnvelope>("EventEnvelope")({
  sequence: Sequence,
  occurredAt: Timestamp,
  commandId: Schema.NullOr(CommandId),
  event: DomainEvent,
}) {}
