/**
 * Remote Access (CONTEXT.md): a Host made reachable from the user's other
 * devices through `tailscale serve`, so Extensions away from it can pair
 * (ADR 0076). Token-less Clients only (`grants.ts`).
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/** Why Remote Access can't be on; each names what the user does next. */
export const RemoteAccessReason = Schema.Literals([
  "not-installed",
  "not-running",
  "not-logged-in",
  "https-disabled",
  /** Enabling Serve would disable the user's Funnel on the whole HTTPS listener. */
  "funnel-on",
  /** A foreground Serve or HTTP listener owns port 443. */
  "port-in-use",
  /** Linux: `tailscale serve` as a user needs `tailscale set --operator=<user>` once. */
  "needs-operator",
  /** No gateway proved itself on its port (ENG-399), so there is nothing to serve. */
  "gateway-not-running",
  /** `/polaris` is served, but not to the running gateway (an old port): exposed, so on. */
  "serving-elsewhere",
  /** Tailscale answered with something Polaris doesn't recognise, or not in time. */
  "failed",
]);

export type RemoteAccessReason = typeof RemoteAccessReason.Type;

export class RemoteAccessStatus extends Schema.Class<RemoteAccessStatus>("RemoteAccessStatus")({
  state: Schema.Literals(["on", "off", "unavailable"]),
  /** The gateway Extensions connect to, `wss://<machine>.<tailnet>.ts.net/polaris/rpc`; null unless on. */
  url: Schema.NullOr(Schema.String),
  /** The Host's MagicDNS name, once Tailscale reports one. */
  hostName: Schema.NullOr(Schema.String),
  /**
   * Set when `state` is `unavailable`; when no gateway is running; and when `on` serves
   * something other than the gateway (then `url` is null and turning off removes it).
   */
  reason: Schema.NullOr(RemoteAccessReason),
}) {}

/** Turning Remote Access on or off failed; the message is Polaris's, never Tailscale's output. */
export class RemoteAccessError extends Schema.TaggedError<RemoteAccessError>()(
  "RemoteAccessError",
  { reason: RemoteAccessReason, message: Schema.String }
) {}

export const GetRemoteAccess = Rpc.make("remoteAccess.status", {
  success: RemoteAccessStatus,
});

/** Serves the gateway at `https://<machine>.<tailnet>.ts.net/polaris`; on again is fine. */
export const EnableRemoteAccess = Rpc.make("remoteAccess.enable", {
  success: RemoteAccessStatus,
  error: RemoteAccessError,
});

/** Removes only Polaris's path from `tailscale serve`; off again is fine. */
export const DisableRemoteAccess = Rpc.make("remoteAccess.disable", {
  success: RemoteAccessStatus,
  error: RemoteAccessError,
});

export class RemoteAccessRpcs extends RpcGroup.make(
  GetRemoteAccess,
  EnableRemoteAccess,
  DisableRemoteAccess
) {}
