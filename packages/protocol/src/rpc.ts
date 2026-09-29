/**
 * The Daemon's RPC surface. Every Client (Desktop App, later the Mobile App)
 * speaks this group; the transport is length-prefixed frames (see frame.ts).
 *
 * Streams open with a snapshot, then send sequenced events; a reconnecting
 * Client passes the last sequence it saw and resumes without gaps.
 * Design follows pingdotgg/t3code@de251fc (MIT): `subscribeShell` /
 * `subscribeThread` with `afterSequence`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CapabilityList } from "./capabilities.ts";
import { Command } from "./commands.ts";
import {
  AgentSession,
  ApprovalRequest,
  Attachment,
  HostInfo,
  Timestamp,
  Turn,
  TurnItem,
  Workspace,
  Worktree,
} from "./domain.ts";
import { EventEnvelope } from "./events.ts";
import { HarnessKind } from "./harnesses.ts";
import { BlobId, CommandId, Sequence, SessionId, TerminalId, TurnId, WorkspaceId } from "./ids.ts";
import { Model } from "./models.ts";
import { UsageReport, UsageStreamItem } from "./usage.ts";

// ── Errors ──────────────────────────────────────────────────────────────────

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  what: Schema.String,
  id: Schema.String,
}) {}

export class CommandRejected extends Schema.TaggedError<CommandRejected>()("CommandRejected", {
  commandId: CommandId,
  reason: Schema.String,
}) {}

export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", {
  capability: Schema.String,
}) {}

export class FileError extends Schema.TaggedError<FileError>()("FileError", {
  path: Schema.String,
  code: Schema.String,
  message: Schema.String,
}) {}

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  cwd: Schema.String,
  message: Schema.String,
}) {}

/** The Harness can't answer on this Host: not installed, not signed in, or it failed. */
export class HarnessUnavailable extends Schema.TaggedError<HarnessUnavailable>()(
  "HarnessUnavailable",
  { harness: HarnessKind, message: Schema.String }
) {}

// ── Handshake ───────────────────────────────────────────────────────────────

export const Hello = Rpc.make("hello", {
  payload: {
    clientName: Schema.String,
    clientVersion: Schema.String,
    /** Label shown to other Clients, e.g. when this device resolves an approval. */
    deviceLabel: Schema.String,
    capabilities: CapabilityList,
  },
  success: Schema.Struct({
    host: HostInfo,
    protocolVersion: Schema.Int,
    capabilities: CapabilityList,
  }),
});

// ── Commands ────────────────────────────────────────────────────────────────

export const Dispatch = Rpc.make("dispatch", {
  payload: { commandId: CommandId, command: Command },
  /** Sequence of the last event the command produced; a retried commandId returns the original. */
  success: Schema.Struct({ sequence: Schema.NullOr(Sequence) }),
  error: Schema.Union([CommandRejected, NotFound]),
});

// ── Streams ─────────────────────────────────────────────────────────────────

export class SessionSummary extends Schema.Class<SessionSummary>("SessionSummary")({
  session: AgentSession,
  pendingApprovals: Schema.Array(ApprovalRequest),
  lastTurnPreview: Schema.NullOr(Schema.String),
}) {}

export const HostStreamItem = Schema.TaggedUnion({
  Snapshot: {
    sequence: Sequence,
    workspaces: Schema.Array(Workspace),
    worktrees: Schema.Array(Worktree),
    sessions: Schema.Array(SessionSummary),
  },
  Event: { envelope: EventEnvelope },
  /** Everything up to now has been sent; later items are live. */
  Synchronized: { sequence: Sequence },
});

export type HostStreamItem = typeof HostStreamItem.Type;

export const SubscribeHost = Rpc.make("subscribeHost", {
  payload: { afterSequence: Schema.NullOr(Sequence) },
  success: HostStreamItem,
  stream: true,
});

export class TurnDetail extends Schema.Class<TurnDetail>("TurnDetail")({
  turn: Turn,
  items: Schema.Array(TurnItem),
}) {}

export const SessionStreamItem = Schema.TaggedUnion({
  Snapshot: {
    sequence: Sequence,
    session: AgentSession,
    turns: Schema.Array(TurnDetail),
    pendingApprovals: Schema.Array(ApprovalRequest),
  },
  Event: { envelope: EventEnvelope },
  /** Ephemeral live output for an item still in progress. Not persisted, not sequenced. */
  Delta: {
    turnId: TurnId,
    itemId: Schema.String,
    field: Schema.Literals(["text", "output"]),
    text: Schema.String,
  },
  /**
   * The latest state of an item still in progress (a running command, a plan being
   * worked through), replacing any earlier progress for the same `item.id`. Like
   * `Delta`: live-only, not persisted, not sequenced; the item's final state
   * arrives as a `TurnItemCompleted` event. Sent only to Clients that announced
   * the `session.live-items` capability. Right after `Synchronized`, the Daemon
   * sends the progress of every item still running, so a Client that subscribes
   * mid-Turn sees them too.
   */
  ItemProgress: { turnId: TurnId, item: TurnItem },
  Synchronized: { sequence: Sequence },
});

export type SessionStreamItem = typeof SessionStreamItem.Type;

export const SubscribeSession = Rpc.make("subscribeSession", {
  payload: {
    sessionId: SessionId,
    afterSequence: Schema.NullOr(Sequence),
    /** Only send the most recent N Turns in the snapshot. */
    turnLimit: Schema.NullOr(Schema.Int),
  },
  success: SessionStreamItem,
  error: NotFound,
  stream: true,
});

/** How to launch a Harness's own terminal UI for a session that is In Terminal. */
export class TerminalLaunch extends Schema.Class<TerminalLaunch>("TerminalLaunch")({
  /** Pass to `terminal.open` as `argv`. */
  argv: Schema.Array(Schema.String),
  /** The session's working directory; pass to `terminal.open` as `cwd`. */
  cwd: Schema.String,
  /** Variables to set on top of the login environment; often empty. */
  env: Schema.Record(Schema.String, Schema.String),
}) {}

/**
 * The terminal UI command for "Open in terminal". Null until the session is
 * In Terminal and the Harness has produced its command (shortly after the
 * `OpenInTerminal` ack), and again after `ReturnFromTerminal`.
 */
export const SessionTerminalCommand = Rpc.make("session.terminalCommand", {
  payload: { sessionId: SessionId },
  success: Schema.NullOr(TerminalLaunch),
  error: NotFound,
});

// ── Harnesses ───────────────────────────────────────────────────────────────

export class HarnessModels extends Schema.Class<HarnessModels>("HarnessModels")({
  harness: HarnessKind,
  /** As the Harness reports them, in its order. */
  models: Schema.Array(Model),
  /**
   * The Harness can change an Agent Session's Model between Turns (`SetModel`).
   * Otherwise a Client offers a Fork with the new Model instead.
   */
  switchesModel: Schema.Boolean,
  /** When the Daemon last asked the Harness; the list is cached per Host. */
  fetchedAt: Timestamp,
}) {}

/**
 * A Harness's Models on this Host (capability `harness.models`). `refresh`
 * asks the Harness again instead of answering from the Daemon's cache.
 */
export const ListModels = Rpc.make("harness.models", {
  payload: { harness: HarnessKind, refresh: Schema.Boolean },
  success: HarnessModels,
  error: Schema.Union([NotFound, Unsupported, HarnessUnavailable]),
});

// ── Usage ───────────────────────────────────────────────────────────────────

/**
 * Hourly Usage buckets that overlap `[from, to)` (capability `usage`),
 * optionally for one Harness or one Agent Session.
 */
export const QueryUsage = Rpc.make("usage.query", {
  payload: {
    from: Timestamp,
    to: Timestamp,
    harness: Schema.NullOr(HarnessKind),
    sessionId: Schema.NullOr(SessionId),
  },
  success: UsageReport,
  error: Unsupported,
});

/**
 * Usage and Plan Limit changes as they happen (capability `usage`): every
 * known Plan Limit first, then changes. A new item kind needs its own
 * capability, sent only to Clients that announce it, as `ItemProgress` does.
 */
export const WatchUsage = Rpc.make("usage.watch", {
  payload: {},
  success: UsageStreamItem,
  error: Unsupported,
  stream: true,
});

// ── Files (read-mostly in M1) ───────────────────────────────────────────────

export const FileKind = Schema.Literals(["file", "directory", "symlink", "other"]);

export class FileEntry extends Schema.Class<FileEntry>("FileEntry")({
  name: Schema.String,
  path: Schema.String,
  kind: FileKind,
  size: Schema.Int,
  modifiedAt: Schema.String,
}) {}

export const ListDir = Rpc.make("files.listDir", {
  payload: { path: Schema.String },
  success: Schema.Array(FileEntry),
  error: FileError,
});

export const Stat = Rpc.make("files.stat", {
  payload: { path: Schema.String },
  success: FileEntry,
  error: FileError,
});

/** What `files.read` returns: inline text, or a BlobId whose bytes follow as binary side-chunks. */
export const FileContent = Schema.TaggedUnion({
  Inline: { text: Schema.String },
  Blob: { blobId: BlobId },
});

export type FileContent = typeof FileContent.Type;

/**
 * Small reads return inline text; larger or binary reads return a BlobId whose
 * bytes follow as binary side-chunks.
 */
export const ReadFile = Rpc.make("files.read", {
  payload: {
    path: Schema.String,
    offset: Schema.NullOr(Schema.Int),
    length: Schema.NullOr(Schema.Int),
  },
  success: Schema.Struct({
    size: Schema.Int,
    mimeType: Schema.String,
    content: FileContent,
  }),
  error: FileError,
});

export const SearchPaths = Rpc.make("files.searchPaths", {
  payload: { root: Schema.String, query: Schema.String, limit: Schema.Int },
  success: Schema.Array(Schema.Struct({ path: Schema.String, score: Schema.Number })),
  error: FileError,
});

export const Grep = Rpc.make("files.grep", {
  payload: {
    root: Schema.String,
    pattern: Schema.String,
    regex: Schema.Boolean,
    caseSensitive: Schema.Boolean,
    limit: Schema.Int,
  },
  success: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      line: Schema.Int,
      column: Schema.Int,
      text: Schema.String,
    })
  ),
  error: FileError,
});

export const FileChangeEvent = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(["created", "modified", "deleted", "renamed"]),
});

export const WatchFiles = Rpc.make("files.watch", {
  payload: { root: Schema.String },
  success: Schema.Array(FileChangeEvent),
  error: FileError,
  stream: true,
});

// ── Git ─────────────────────────────────────────────────────────────────────

export class GitStatusEntry extends Schema.Class<GitStatusEntry>("GitStatusEntry")({
  path: Schema.String,
  origPath: Schema.NullOr(Schema.String),
  index: Schema.String,
  worktree: Schema.String,
}) {}

export const GitStatus = Rpc.make("git.status", {
  payload: { cwd: Schema.String },
  success: Schema.Struct({
    branch: Schema.NullOr(Schema.String),
    head: Schema.NullOr(Schema.String),
    ahead: Schema.Int,
    behind: Schema.Int,
    entries: Schema.Array(GitStatusEntry),
  }),
  error: GitError,
});

/** What `git.diff` compares. */
export const GitDiffSpec = Schema.TaggedUnion({
  WorkingTree: { base: Schema.NullOr(Schema.String) },
  Turn: { sessionId: SessionId, turnId: TurnId },
  Range: { base: Schema.String, head: Schema.String },
});

export type GitDiffSpec = typeof GitDiffSpec.Type;

/** A unified diff; delivered as a blob because diffs can be very large. */
export const GitDiff = Rpc.make("git.diff", {
  payload: {
    cwd: Schema.String,
    spec: GitDiffSpec,
  },
  success: Schema.Struct({ blobId: BlobId, size: Schema.Int, files: Schema.Int }),
  error: Schema.Union([GitError, NotFound]),
});

// ── Attachments ─────────────────────────────────────────────────────────────

/** The Client first sends the bytes as binary side-chunks under `blobId`. */
export const StageAttachment = Rpc.make("attachments.stage", {
  payload: {
    sessionId: Schema.NullOr(SessionId),
    workspaceId: WorkspaceId,
    name: Schema.String,
    mimeType: Schema.String,
    blobId: BlobId,
  },
  success: Attachment,
  error: FileError,
});

// ── Terminal (one per Workspace, via Bun.Terminal) ──────────────────────────

export const TerminalOpen = Rpc.make("terminal.open", {
  payload: {
    cwd: Schema.String,
    cols: Schema.Int,
    rows: Schema.Int,
    /** Command to run instead of the login shell, e.g. a Harness TUI for "Open in terminal". */
    argv: Schema.NullOr(Schema.Array(Schema.String)),
  },
  success: Schema.Struct({ terminalId: TerminalId }),
  error: FileError,
});

/** Output bytes, base64 in JSON. Replays recent scrollback first on attach. */
export const TerminalAttach = Rpc.make("terminal.attach", {
  payload: { terminalId: TerminalId },
  success: Schema.TaggedUnion({
    Output: { data: Schema.Uint8ArrayFromBase64 },
    Exit: { code: Schema.NullOr(Schema.Int) },
  }),
  error: NotFound,
  stream: true,
});

/**
 * `terminal.attach` with the output as raw bytes instead of base64 in JSON
 * (capability `terminal.binary`). The first item names one long-lived blob
 * that carries all the output, scrollback first, as binary side-chunks; take
 * it as a stream (`takeStream`, idle timeout off). It ends when the output
 * does, and `Exit` follows. `Exit` can arrive before the blob's last chunks
 * (JSON frames are never queued behind blob chunks), so wait for the blob to
 * end before acting on it. Ending the stream stops the blob.
 */
export const TerminalAttachBinary = Rpc.make("terminal.attachBinary", {
  payload: { terminalId: TerminalId },
  success: Schema.TaggedUnion({
    Output: { blobId: BlobId },
    Exit: { code: Schema.NullOr(Schema.Int) },
  }),
  error: NotFound,
  stream: true,
});

export const TerminalInput = Rpc.make("terminal.input", {
  payload: { terminalId: TerminalId, data: Schema.Uint8ArrayFromBase64 },
  error: NotFound,
});

export const TerminalResize = Rpc.make("terminal.resize", {
  payload: { terminalId: TerminalId, cols: Schema.Int, rows: Schema.Int },
  error: NotFound,
});

export const TerminalClose = Rpc.make("terminal.close", {
  payload: { terminalId: TerminalId },
  error: NotFound,
});

// ── Group ───────────────────────────────────────────────────────────────────

export class DaemonRpcs extends RpcGroup.make(
  Hello,
  Dispatch,
  SubscribeHost,
  SubscribeSession,
  SessionTerminalCommand,
  ListModels,
  QueryUsage,
  WatchUsage,
  ListDir,
  Stat,
  ReadFile,
  SearchPaths,
  Grep,
  WatchFiles,
  GitStatus,
  GitDiff,
  StageAttachment,
  TerminalOpen,
  TerminalAttach,
  TerminalAttachBinary,
  TerminalInput,
  TerminalResize,
  TerminalClose
) {}
