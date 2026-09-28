/**
 * Domain model shared by the Daemon and every Client. Names follow CONTEXT.md.
 */
import { Schema } from "effect";
import {
  AttachmentId,
  HostId,
  RequestId,
  SessionId,
  TurnId,
  WorkspaceId,
  WorktreeId,
} from "./ids.ts";

export const Timestamp = Schema.String; // ISO-8601, UTC

export type Timestamp = typeof Timestamp.Type;

export const HarnessKind = Schema.Literals(["claude", "codex"]);

export type HarnessKind = typeof HarnessKind.Type;

export const SessionState = Schema.Literals([
  "starting",
  "working",
  "needs-you",
  "idle",
  "in-terminal",
  "dormant",
  "failed",
  "archived",
]);

export type SessionState = typeof SessionState.Type;

/** Client-side only: how one Client's link to one Host stands. Never sent by a Daemon. */
export const ConnectionState = Schema.Literals([
  "connected",
  "reconnecting",
  "needs-attention",
  "offline",
]);

export type ConnectionState = typeof ConnectionState.Type;

export const Platform = Schema.Literals(["darwin-arm64", "linux-x64", "linux-arm64"]);

export type Platform = typeof Platform.Type;

export class HostInfo extends Schema.Class<HostInfo>("HostInfo")({
  hostId: HostId,
  hostname: Schema.String,
  platform: Platform,
  daemonVersion: Schema.String,
  homeDir: Schema.String,
  startedAt: Timestamp,
}) {}

export class Workspace extends Schema.Class<Workspace>("Workspace")({
  id: WorkspaceId,
  path: Schema.String,
  name: Schema.String,
  isGitRepo: Schema.Boolean,
  /** Where Polaris creates its own Worktrees; default `<repo>.worktrees/<branch>`. */
  worktreeRoot: Schema.String,
  hidden: Schema.Boolean,
  registeredAt: Timestamp,
}) {}

export class Worktree extends Schema.Class<Worktree>("Worktree")({
  id: WorktreeId,
  workspaceId: WorkspaceId,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  head: Schema.String,
  /** The Agent Session that created it, when known; otherwise it sits under the Workspace. */
  createdBySessionId: Schema.NullOr(SessionId),
  isMain: Schema.Boolean,
}) {}

export const PermissionMode = Schema.Literals(["supervised", "auto-edits", "auto", "full-access"]);

export type PermissionMode = typeof PermissionMode.Type;

export class AgentSession extends Schema.Class<AgentSession>("AgentSession")({
  id: SessionId,
  workspaceId: WorkspaceId,
  harness: HarnessKind,
  title: Schema.String,
  /** The directory the Harness works in: the Workspace itself or one of its Worktrees. */
  cwd: Schema.String,
  worktreeId: Schema.NullOr(WorktreeId),
  state: SessionState,
  permissionMode: PermissionMode,
  model: Schema.NullOr(Schema.String),
  /** Set when this session is a Fork. */
  parentSessionId: Schema.NullOr(SessionId),
  forkedFromTurnId: Schema.NullOr(TurnId),
  /** Opaque Harness-native resume handle (Claude session id, Codex thread id). */
  harnessCursor: Schema.NullOr(Schema.String),
  turnCount: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}) {}

export const TurnStatus = Schema.Literals(["working", "completed", "interrupted", "failed"]);

export type TurnStatus = typeof TurnStatus.Type;

export class Attachment extends Schema.Class<Attachment>("Attachment")({
  id: AttachmentId,
  name: Schema.String,
  mimeType: Schema.String,
  size: Schema.Int,
  /** Absolute path on the Host under `~/.polaris/staging/<session>/`. */
  hostPath: Schema.String,
}) {}

export class Turn extends Schema.Class<Turn>("Turn")({
  id: TurnId,
  sessionId: SessionId,
  index: Schema.Int,
  prompt: Schema.String,
  attachments: Schema.Array(Attachment),
  status: TurnStatus,
  /** `refs/polaris/checkpoints/<session>/<turn>` taken before and after the Turn. */
  checkpointBefore: Schema.NullOr(Schema.String),
  checkpointAfter: Schema.NullOr(Schema.String),
  startedAt: Timestamp,
  endedAt: Schema.NullOr(Timestamp),
}) {}

/** One normalized piece of Harness output within a Turn. `raw` keeps the native frame. */
export const TurnItem = Schema.TaggedUnion({
  AssistantMessage: { id: Schema.String, text: Schema.String },
  Reasoning: { id: Schema.String, text: Schema.String },
  CommandExecution: {
    id: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    output: Schema.String,
    exitCode: Schema.NullOr(Schema.Int),
    status: Schema.Literals(["running", "completed", "failed", "declined"]),
  },
  FileChange: {
    id: Schema.String,
    changes: Schema.Array(
      Schema.Struct({ path: Schema.String, kind: Schema.Literals(["add", "modify", "delete"]) })
    ),
    status: Schema.Literals(["running", "completed", "failed", "declined"]),
  },
  ToolCall: {
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
    output: Schema.NullOr(Schema.Unknown),
    status: Schema.Literals(["running", "completed", "failed", "declined"]),
  },
  Plan: {
    id: Schema.String,
    steps: Schema.Array(
      Schema.Struct({
        text: Schema.String,
        status: Schema.Literals(["pending", "in-progress", "completed"]),
      })
    ),
  },
  Error: { id: Schema.String, message: Schema.String },
});

export type TurnItem = typeof TurnItem.Type;

export const ApprovalKind = Schema.Literals(["command", "file-change", "tool", "question"]);

export type ApprovalKind = typeof ApprovalKind.Type;

export class ApprovalRequest extends Schema.Class<ApprovalRequest>("ApprovalRequest")({
  id: RequestId,
  sessionId: SessionId,
  turnId: TurnId,
  kind: ApprovalKind,
  /** One-line summary for hover cards and notifications. */
  title: Schema.String,
  detail: Schema.NullOr(Schema.String),
  /** For questions: the choices offered, if any. */
  options: Schema.Array(Schema.String),
  openedAt: Timestamp,
}) {}

export const ApprovalDecision = Schema.TaggedUnion({
  Allow: { remember: Schema.Boolean },
  Deny: { reason: Schema.NullOr(Schema.String) },
  Answer: { text: Schema.String },
});

export type ApprovalDecision = typeof ApprovalDecision.Type;
