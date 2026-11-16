/**
 * A connection over the Relay route that acts as a Teammate (ADR 0112): the server annotates
 * it before any request runs, the Share gate scopes every request to the person's live Shares,
 * and `dispatch` records the Teammate as the actor.
 */
import type { Actor, Grant, PersonId } from "@polaris/protocol";
import type { RelayAddress } from "@polaris/protocol/relay";
import { Context, type Effect } from "effect";
import type { Rpc } from "effect/rpc";
import type { DeviceSession } from "../linkedDevices/session.ts";

/** One device of a person, as their Account Server vouched for it. */
export interface TeammateDevice {
  readonly issuer: string;
  readonly personId: PersonId;
  /** base64url of the device's Noise static public key. */
  readonly noiseKey: string;
  readonly relayAddress: RelayAddress;
}

export class ConnectionTeammate extends Context.Service<ConnectionTeammate, TeammateDevice>()(
  "polaris/daemon/shares/ConnectionTeammate"
) {}

export const teammateOf = (client: Rpc.ServerClient): TeammateDevice | null =>
  Context.getOrUndefined(client.annotations, ConnectionTeammate) ?? null;

/** How the server serves a Teammate's session: a connection acting as that person. */
export class TeammateConnections extends Context.Service<
  TeammateConnections,
  { readonly serve: (session: DeviceSession, teammate: TeammateDevice) => Effect.Effect<void> }
>()("polaris/daemon/shares/TeammateConnections") {}

/**
 * Set by the Share gate on a Teammate's request it let through: the Share that covers it, as
 * the Actor to record and the Grant its Turns are decided on.
 */
export class RequestShare extends Context.Service<
  RequestShare,
  { readonly actor: Actor; readonly grant: Grant }
>()("polaris/daemon/shares/RequestShare") {}
