/** A Host's Connection State as Raycast sees it, from the SDK's view of that Host. */
import { HostUnreachable, type HostView } from "@polaris/sdk";

export type ConnectionState = "connected" | "reconnecting" | "needs-attention" | "offline";

export const CONNECTION_LABEL: Readonly<Record<ConnectionState, string>> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  "needs-attention": "Needs attention",
  offline: "Offline",
};

/**
 * Live is Connected; a dropped link the SDK retries is Reconnecting; a refusal
 * (revoked token, version mismatch) Needs Attention; a Host never reached is Offline.
 */
export const connectionState = (view: Pick<HostView, "connected" | "error">): ConnectionState => {
  if (view.connected) return "connected";

  if (view.error === null) return "reconnecting";

  return view.error instanceof HostUnreachable ? "offline" : "needs-attention";
};

/** Whether a command can show its Hosts yet: `unavailable` once every Host failed. */
export type Availability = "waiting" | "unavailable" | "available";

export const availability = (
  views: ReadonlyArray<Pick<HostView, "error">>,
  hostCount: number
): Availability => {
  if (views.some((view) => view.error === null)) return "available";

  return views.length === hostCount ? "unavailable" : "waiting";
};
