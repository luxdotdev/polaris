/**
 * Presence (ENG-495): whether the user is at a Desktop App. While any Desktop App
 * connected to a Host reports `present`, the Host holds its pushes to Linked Devices
 * and sends the ones still needing the user once presence ends. Capability `presence`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/** Only this crosses the wire: never idle times or lock events. */
export const UserPresence = Schema.Literals(["present", "away"]);

export type UserPresence = typeof UserPresence.Type;

export class PresenceLease extends Schema.Class<PresenceLease>("PresenceLease")({
  /** How long a `present` report holds; the Client renews well within it. 0 for `away`. */
  leaseMs: Schema.Int,
}) {}

/**
 * Reports this connection's presence. `present` is a lease, renewed by reporting again;
 * it ends on `away`, when it lapses, or when the connection closes. Desktop App only.
 */
export const ReportPresence = Rpc.make("presence.report", {
  payload: { presence: UserPresence },
  success: PresenceLease,
});

export class PresenceRpcs extends RpcGroup.make(ReportPresence) {}
