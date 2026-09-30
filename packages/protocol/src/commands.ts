/**
 * Commands a Client dispatches to a Daemon. Each carries a Client-chosen
 * `commandId`; the Daemon stores a receipt so a retried command is applied once.
 * An ack means "intent recorded", not "the Harness finished".
 */
import { Schema } from "effect";
import { ApprovalDecision, PermissionMode } from "./domain.ts";
import { HarnessKind } from "./harnesses.ts";
import { AttachmentId, RequestId, SessionId, TurnId, WorkspaceId } from "./ids.ts";
import { addedNullable, ModelId, ReasoningEffort } from "./models.ts";

export const SessionPlacement = Schema.TaggedUnion({
  /** Work directly in the Workspace directory (the default). */
  InPlace: {},
  /** Create a new Worktree at `<worktreeRoot>/<branch>`. */
  NewWorktree: { branch: Schema.String, baseRef: Schema.NullOr(Schema.String) },
  /** Use a Worktree that already exists. */
  ExistingWorktree: { path: Schema.String },
});

export type SessionPlacement = typeof SessionPlacement.Type;

export const Command = Schema.TaggedUnion({
  RegisterWorkspace: { path: Schema.String, name: Schema.NullOr(Schema.String) },
  SetWorkspaceHidden: { workspaceId: WorkspaceId, hidden: Schema.Boolean },
  RemoveWorkspace: { workspaceId: WorkspaceId },

  StartSession: {
    sessionId: SessionId,
    workspaceId: WorkspaceId,
    harness: HarnessKind,
    placement: SessionPlacement,
    permissionMode: PermissionMode,
    /** The initial Model and effort; null for the Harness's and the Model's defaults. */
    model: Schema.NullOr(ModelId),
    effort: addedNullable(ReasoningEffort),
    prompt: Schema.String,
    attachments: Schema.Array(AttachmentId),
  },
  SendTurn: {
    sessionId: SessionId,
    prompt: Schema.String,
    attachments: Schema.Array(AttachmentId),
  },
  /** Add guidance to the Turn in flight without interrupting it, where the Harness supports it. */
  Steer: { sessionId: SessionId, text: Schema.String },
  Interrupt: { sessionId: SessionId },
  /** Continue an Interrupted Turn after a Daemon restart. Never done automatically. */
  Continue: { sessionId: SessionId },
  /** Send a Failed Turn's prompt and attachments again, as a new Turn. */
  Retry: { sessionId: SessionId },
  RespondToApproval: {
    sessionId: SessionId,
    requestId: RequestId,
    decision: ApprovalDecision,
  },
  RenameSession: { sessionId: SessionId, title: Schema.String },
  SetPermissionMode: { sessionId: SessionId, permissionMode: PermissionMode },
  /**
   * The Model and effort for the next Turns (capability `session.set-model`).
   * Only between Turns, and only where the Harness can switch Model mid-session;
   * otherwise fork with the new Model.
   */
  SetModel: { sessionId: SessionId, model: ModelId, effort: Schema.NullOr(ReasoningEffort) },
  ForkSession: {
    sessionId: SessionId,
    fromSessionId: SessionId,
    fromTurnId: TurnId,
    harness: HarnessKind,
    /** Null keeps the parent's Model and effort for the same Harness, else the defaults. */
    model: addedNullable(ModelId),
    effort: addedNullable(ReasoningEffort),
  },
  /** Archive removes the session's Worktree but keeps its branch; unmerged branches are never deleted. */
  ArchiveSession: { sessionId: SessionId, deleteMergedBranch: Schema.Boolean },
  UnarchiveSession: { sessionId: SessionId },
  /** Hand the session to the Harness's own terminal UI (In Terminal). */
  OpenInTerminal: { sessionId: SessionId },
  /** Take the session back from the terminal UI. */
  ReturnFromTerminal: { sessionId: SessionId },
});

export type Command = typeof Command.Type;
