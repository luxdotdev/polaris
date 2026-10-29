/**
 * Restart daemon (Settings → Hosts): what a restart would interrupt, and the step
 * that ends in-process Harness Turns before the Client asks the Host's service
 * manager to restart the Daemon (ADR 0086). Token-less Clients only (`grants.ts`).
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { HarnessKind } from "./harnesses.ts";
import { SessionId } from "./ids.ts";

/** A Working session a restart would stop, for the confirm's well. */
export class RestartWorkingSession extends Schema.Class<RestartWorkingSession>(
  "RestartWorkingSession"
)({
  sessionId: SessionId,
  title: Schema.String,
  harness: HarnessKind,
  /** The Turn in flight, 1-based ("Working · turn 12"). */
  turn: Schema.Int,
}) {}

/** What a restart would interrupt right now. */
export class RestartPreview extends Schema.Class<RestartPreview>("RestartPreview")({
  workingSessions: Schema.Array(RestartWorkingSession),
  /** Terminals still running; they end with the Daemon. */
  terminals: Schema.Int,
  /** Approval requests a restart withdraws (ADR 0004). */
  pendingApprovals: Schema.Int,
}) {}

export class RestartError extends Schema.TaggedError<RestartError>()("RestartError", {
  message: Schema.String,
}) {}

export const GetRestartPreview = Rpc.make("host.restartPreview", {
  payload: {},
  success: RestartPreview,
  error: RestartError,
});

/**
 * Ends the Turns of in-process Harnesses as before an upgrade (`prepareForUpgrade`),
 * so they stop cleanly. The Daemon keeps serving; the Client then restarts its service.
 */
export const PrepareRestart = Rpc.make("host.prepareRestart", {
  payload: {},
  success: Schema.Struct({ interruptedTurns: Schema.Int }),
  error: RestartError,
});

export class RestartRpcs extends RpcGroup.make(GetRestartPreview, PrepareRestart) {}
