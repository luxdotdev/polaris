/**
 * The session machine's vocabulary (README.md here): its inputs, Client
 * commands and engine signals, as Effect Schemas, and what it emits.
 */
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  type DomainEvent,
  ModelId,
  PermissionMode,
  ReasoningEffort,
  RequestId,
  Subagent,
  SubagentId,
  Turn,
  TurnId,
  TurnStatus,
} from "@polaris/protocol";
import { Schema } from "effect";
import type { EventObject } from "xstate";

// Effect Schemas as Standard Schemas: XState v6 infers its event types from them.
const standard = Schema.toStandardSchemaV1;

const At = { at: Schema.String };

const Nothing = standard(Schema.Struct({}));

export const eventSchemas = {
  // Client commands
  "session.start": standard(Schema.Struct({ session: AgentSession, turn: Turn })),
  "session.fork": standard(Schema.Struct({ session: AgentSession })),
  "turn.send": standard(Schema.Struct({ turn: Turn })),
  "turn.continue": Nothing,
  "turn.retry": standard(Schema.Struct({ turn: Turn })),
  "turn.steer": standard(Schema.Struct({ canSteer: Schema.Boolean })),
  "turn.interrupt": Nothing,
  "approval.respond": standard(
    Schema.Struct({ requestId: RequestId, decision: ApprovalDecision, resolvedBy: Schema.String })
  ),
  "permissionMode.set": standard(Schema.Struct({ permissionMode: PermissionMode })),
  "model.set": standard(
    Schema.Struct({
      model: ModelId,
      effort: Schema.NullOr(ReasoningEffort),
      canSwitchModel: Schema.Boolean,
    })
  ),
  "turns.accept": standard(
    Schema.Struct({
      turnId: TurnId,
      index: Schema.Int,
      status: TurnStatus,
      revertLaterTurns: Schema.Boolean,
      acceptedBy: Schema.String,
    })
  ),
  "session.archive": standard(Schema.Struct(At)),
  "session.unarchive": Nothing,
  "terminal.open": Nothing,
  "terminal.return": Nothing,
  // Engine signals
  "harness.opened": Nothing,
  "harness.turnStarted": standard(Schema.Struct({ turnId: TurnId, prompt: Schema.String, ...At })),
  "harness.approvalRequested": standard(Schema.Struct({ request: ApprovalRequest })),
  "harness.approvalWithdrawn": standard(Schema.Struct({ requestId: RequestId })),
  "harness.subagentStarted": standard(Schema.Struct({ subagent: Subagent })),
  "harness.subagentEnded": standard(
    Schema.Struct({
      subagentId: SubagentId,
      status: Schema.Literals(["completed", "failed", "interrupted"]),
      ...At,
    })
  ),
  "harness.turnEnded": standard(
    Schema.Struct({
      turnId: TurnId,
      status: Schema.Literals(["completed", "interrupted", "failed"]),
      error: Schema.NullOr(Schema.String),
      checkpoint: Schema.NullOr(Schema.Struct({ ref: Schema.String, commit: Schema.String })),
      ...At,
    })
  ),
  "harness.exited": standard(Schema.Struct({ error: Schema.NullOr(Schema.String), ...At })),
  "harness.resumed": Nothing,
  "terminal.closed": standard(Schema.Struct(At)),
  "idle.timeout": standard(Schema.Struct({ harnessLive: Schema.Boolean })),
  "session.fail": standard(Schema.Struct({ message: Schema.String, ...At })),
  "turn.interruptUnattended": standard(Schema.Struct(At)),
  "daemon.recover": standard(
    Schema.Struct({ cause: Schema.Literals(["restart", "upgrade"]), ...At })
  ),
};

type EventSchemas = typeof eventSchemas;

/** An input to the session machine: a Client command or an engine signal. */
export type SessionInput = {
  [K in keyof EventSchemas]: { readonly type: K } & EventSchemas[K]["Type"];
}[keyof EventSchemas];

/** Something the engine does after the events commit. */
export type SessionEffect =
  /** The session went Idle: stop its Harness after `EngineConfig.idleTimeout`. */
  | "scheduleIdleStop"
  /** The idle timer fired and the session went Dormant: stop its Harness now. */
  | "stopHarness";

export type Emitted =
  | { readonly type: "domain"; readonly event: DomainEvent }
  | { readonly type: "rejected"; readonly reason: string }
  | { readonly type: "effect"; readonly effect: SessionEffect };

const EMITTED: ReadonlySet<string> = new Set<Emitted["type"]>(["domain", "rejected", "effect"]);

/** What the machine emits is ours: every `enq.emit` here passes an `Emitted`. */
export const isEmitted = (event: EventObject): event is Emitted => EMITTED.has(event.type);
