/**
 * The development route to a Host: `scripts/devBridge.ts` on this Mac forwards a loopback
 * WebSocket to the Daemon's Unix socket with Client power, behind a random token. Development
 * builds only; release builds reach Hosts through the Polaris Relay.
 */
import { ConnectFailure } from "@polaris/client/failures";
import { webSocketTransport } from "@polaris/sdk";
import { Effect } from "effect";
import type { HostTransport } from "./hostConnection.ts";

export interface DevBridge {
  readonly hostId: string;
  readonly port: number;
  readonly token: string;
}

const PREFIX = "polaris-dev-bridge:v1:";

/** What the script prints: `polaris-dev-bridge:v1:<port>:<token>:<hostId>`. */
export const formatDevBridge = (bridge: DevBridge): string =>
  `${PREFIX}${bridge.port}:${bridge.token}:${bridge.hostId}`;

export const parseDevBridge = (text: string): DevBridge | null => {
  if (!text.startsWith(PREFIX)) return null;
  const [port, token, hostId] = text.slice(PREFIX.length).split(":");
  const portNumber = Number(port);

  if (!Number.isInteger(portNumber) || token === undefined || token === "") return null;

  if (hostId === undefined || hostId === "") return null;

  return { hostId, port: portNumber, token };
};

export const devBridgeUrl = (bridge: Pick<DevBridge, "port" | "token">): string =>
  `ws://127.0.0.1:${bridge.port}/polaris/rpc?token=${encodeURIComponent(bridge.token)}`;

export const devBridgeTransport = (bridge: DevBridge): HostTransport => ({
  route: "dev-bridge",
  open: webSocketTransport(devBridgeUrl(bridge), bridge.hostId).pipe(
    Effect.mapError(
      (error) =>
        new ConnectFailure({ kind: "transient", reason: "unreachable", detail: error.detail })
    )
  ),
});
