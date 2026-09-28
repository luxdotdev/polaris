/**
 * Handlers for the engine's three RPCs: `dispatch`, `subscribeHost` and
 * `subscribeSession`. The transport mounts `EngineRpcHandlers` next to the
 * other modules' handlers when it builds the `DaemonRpcs` server:
 *
 *   RpcServer.layer(DaemonRpcs).pipe(
 *     Layer.provide(EngineRpcHandlers),
 *     Layer.provide(OtherHandlers), ...)
 *
 * The device label for `ApprovalResolved.resolvedBy` comes from the Client's
 * `hello`: the hello handler annotates the connection with
 * `options.client.annotate(DeviceLabel, payload.deviceLabel)`.
 */
import { DaemonRpcs } from "@polaris/protocol"
import { Context, Effect, Layer } from "effect"
import { Engine } from "./Engine.ts"

/** Per-connection annotation set by the `hello` handler. */
export class DeviceLabel extends Context.Service<DeviceLabel, string>()(
  "polaris/daemon/engine/DeviceLabel",
) {}

export const UNKNOWN_DEVICE = "Unknown device"

const DispatchHandler = DaemonRpcs.toLayerHandler(
  "dispatch",
  Effect.gen(function* () {
    const engine = yield* Engine
    return ({ commandId, command }, { client }) =>
      engine.dispatch({
        commandId,
        command,
        deviceLabel: Context.getOrUndefined(client.annotations, DeviceLabel) ?? UNKNOWN_DEVICE,
      })
  }),
)

const SubscribeHostHandler = DaemonRpcs.toLayerHandler(
  "subscribeHost",
  Effect.gen(function* () {
    const engine = yield* Engine
    return ({ afterSequence }) => engine.subscribeHost(afterSequence)
  }),
)

const SubscribeSessionHandler = DaemonRpcs.toLayerHandler(
  "subscribeSession",
  Effect.gen(function* () {
    const engine = yield* Engine
    return ({ sessionId, afterSequence, turnLimit }) =>
      engine.subscribeSession({ sessionId, afterSequence, turnLimit })
  }),
)

export const EngineRpcHandlers = Layer.mergeAll(
  DispatchHandler,
  SubscribeHostHandler,
  SubscribeSessionHandler,
)
