/**
 * The contract every Harness driver implements. Polaris drives Harnesses and
 * never reimplements one: each driver adapts a vendor's structured interface
 * (Codex app-server, Claude Agent SDK) into these normalized events.
 *
 * The orchestration engine owns persistence and Session State; drivers only
 * translate. A driver never writes to the event store directly.
 */
import type {
  ApprovalDecision,
  ApprovalKind,
  Attachment,
  HarnessKind,
  PermissionMode,
  RequestId,
  SessionId,
  TurnId,
  TurnItem,
} from "@polaris/protocol"
import { type Effect, Schema, type Scope, type Stream } from "effect"

export class HarnessError extends Schema.TaggedError<HarnessError>()("HarnessError", {
  harness: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type HarnessEvent =
  /** The Harness-native resume handle is known (or changed); persist it. */
  | { readonly _tag: "CursorAssigned"; readonly cursor: string }
  | { readonly _tag: "TurnStarted"; readonly turnId: TurnId }
  /** Ephemeral streaming text for an item still in progress. */
  | {
      readonly _tag: "ItemDelta"
      readonly turnId: TurnId
      readonly itemId: string
      readonly field: "text" | "output"
      readonly text: string
    }
  | { readonly _tag: "ItemCompleted"; readonly turnId: TurnId; readonly item: TurnItem }
  | {
      readonly _tag: "ApprovalRequested"
      readonly turnId: TurnId
      readonly requestId: RequestId
      readonly kind: ApprovalKind
      readonly title: string
      readonly detail: string | null
      readonly options: ReadonlyArray<string>
    }
  /** The Harness withdrew or resolved a request itself (e.g. the Turn was interrupted). */
  | { readonly _tag: "ApprovalWithdrawn"; readonly requestId: RequestId }
  | {
      readonly _tag: "TurnEnded"
      readonly turnId: TurnId
      readonly status: "completed" | "interrupted" | "failed"
      readonly error: string | null
    }
  | { readonly _tag: "TitleSuggested"; readonly title: string }
  /** A Worktree the Harness created, so the engine can attribute it to this session. */
  | { readonly _tag: "WorktreeCreated"; readonly path: string }
  /** The Harness process went away. `error` is null for a clean shutdown. */
  | { readonly _tag: "Exited"; readonly error: string | null }

export interface OpenOptions {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly permissionMode: PermissionMode
  readonly model: string | null
  /** Resume an existing Harness-native session; null starts a fresh one. */
  readonly resumeCursor: string | null
}

export interface TurnInput {
  readonly turnId: TurnId
  readonly prompt: string
  readonly attachments: ReadonlyArray<Attachment>
}

export interface HarnessSession {
  /** Every event the Harness emits for this session, until it exits. Single consumer. */
  readonly events: Stream.Stream<HarnessEvent>
  readonly sendTurn: (input: TurnInput) => Effect.Effect<void, HarnessError>
  /** Add guidance to the Turn in flight; fails if the Harness lacks `steer`. */
  readonly steer: (text: string) => Effect.Effect<void, HarnessError>
  readonly interrupt: Effect.Effect<void, HarnessError>
  readonly respond: (
    requestId: RequestId,
    decision: ApprovalDecision,
  ) => Effect.Effect<void, HarnessError>
  readonly setPermissionMode: (mode: PermissionMode) => Effect.Effect<void, HarnessError>
  /**
   * argv for "Open in terminal": the Harness's own TUI attached to this session.
   * Codex co-attaches live to the shared app-server; Claude hands off sequentially,
   * so the engine closes this session before launching it.
   */
  readonly terminalCommand: Effect.Effect<ReadonlyArray<string>, HarnessError>
}

export interface HarnessProbe {
  readonly available: boolean
  readonly version: string | null
  readonly detail: string | null
}

export interface HarnessDriver {
  readonly kind: HarnessKind
  readonly capabilities: {
    readonly steer: boolean
    /** Terminal UI can attach while Polaris stays attached (Codex). */
    readonly liveCoAttach: boolean
  }
  /** Must have no side effects: never open an authenticated session or start MCP servers. */
  readonly probe: Effect.Effect<HarnessProbe>
  /** Starts or resumes a Harness session. Closing the scope stops it (the session goes Dormant). */
  readonly open: (options: OpenOptions) => Effect.Effect<HarnessSession, HarnessError, Scope.Scope>
}
