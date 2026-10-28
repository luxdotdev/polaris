/**
 * A connection over the Relay route acts as its Linked Device (ADR 0082): the server
 * annotates it before any request runs, `dispatch` records the device as the actor,
 * and `hello` labels it with the device's name whatever the payload says.
 */
import type { LinkedDevice } from "@polaris/protocol";
import { Context } from "effect";
import type { Rpc } from "effect/rpc";

export class ConnectionDevice extends Context.Service<ConnectionDevice, LinkedDevice>()(
  "polaris/daemon/linkedDevices/ConnectionDevice"
) {}

export const deviceOf = (client: Rpc.ServerClient): LinkedDevice | null =>
  Context.getOrUndefined(client.annotations, ConnectionDevice) ?? null;
