/**
 * Handlers for the engine's RPCs: `dispatch`, `subscribeHost`,
 * `subscribeSession` and `session.terminalCommand`. The transport mounts
 * `EngineRpcHandlers` next to the other modules' handlers when it builds the
 * `DaemonRpcs` server:
 *
 *   RpcServer.layer(DaemonRpcs).pipe(
 *     Layer.provide(EngineRpcHandlers),
 *     Layer.provide(OtherHandlers), ...)
 *
 * The device label for `ApprovalResolved.resolvedBy` comes from the Client's
 * `hello`: the hello handler annotates the connection with
 * `options.client.annotate(DeviceLabel, payload.deviceLabel)`, and the
 * Client's capabilities with `ClientCapabilities` (only Clients that announced
 * `session.live-items` get `ItemProgress` on session streams).
 */
import { type Capability, DaemonRpcs, NotFound } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import { Engine } from "./Engine.ts";

/** Per-connection annotation set by the `hello` handler. */
export class DeviceLabel extends Context.Service<DeviceLabel, string>()(
  "polaris/daemon/engine/DeviceLabel"
) {}

/** Per-connection annotation set by the `hello` handler: what the Client understands. */
export class ClientCapabilities extends Context.Service<
  ClientCapabilities,
  ReadonlyArray<Capability>
>()("polaris/daemon/engine/ClientCapabilities") {}

export const UNKNOWN_DEVICE = "Unknown device";

/** Whether the Client announced `capability` in its `hello`. */
const announced = (annotations: Context.Context<never>, capability: Capability) =>
  (Context.getOrUndefined(annotations, ClientCapabilities) ?? []).includes(capability);

const DispatchHandler = DaemonRpcs.toLayerHandler(
  "dispatch",
  Effect.gen(function* () {
    const engine = yield* Engine;

    return ({ commandId, command }, { client }) =>
      engine.dispatch({
        commandId,
        command,
        deviceLabel: Context.getOrUndefined(client.annotations, DeviceLabel) ?? UNKNOWN_DEVICE,
      });
  })
);

const SubscribeHostHandler = DaemonRpcs.toLayerHandler(
  "subscribeHost",
  Effect.gen(function* () {
    const engine = yield* Engine;

    return ({ afterSequence }, { client }) =>
      engine.subscribeHost(afterSequence, {
        subagents: announced(client.annotations, "session.subagents"),
      });
  })
);

const SubscribeSessionHandler = DaemonRpcs.toLayerHandler(
  "subscribeSession",
  Effect.gen(function* () {
    const engine = yield* Engine;

    return ({ sessionId, afterSequence, turnLimit }, { client }) =>
      engine.subscribeSession({
        sessionId,
        afterSequence,
        turnLimit,
        liveItems: announced(client.annotations, "session.live-items"),
        subagents: announced(client.annotations, "session.subagents"),
      });
  })
);

const TerminalCommandHandler = DaemonRpcs.toLayerHandler(
  "session.terminalCommand",
  Effect.gen(function* () {
    const engine = yield* Engine;

    return ({ sessionId }) =>
      Effect.gen(function* () {
        if (!(yield* engine.hasSession(sessionId))) {
          return yield* new NotFound({ what: "session", id: sessionId });
        }

        return yield* engine.terminalCommand(sessionId);
      });
  })
);

export const EngineRpcHandlers = Layer.mergeAll(
  DispatchHandler,
  SubscribeHostHandler,
  SubscribeSessionHandler,
  TerminalCommandHandler
);
