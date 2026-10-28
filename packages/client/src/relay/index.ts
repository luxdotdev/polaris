/**
 * The Polaris Relay as a Linked Device's transport (apps/relay/README.md): link once,
 * then a Noise session per Host as the ByteTransport a Client connects over. Imports
 * libsodium through `@polaris/protocol/relay/party`, so it is a separate entry.
 */
export * from "./device.ts";

export {
  checkLinkedHosts,
  LinkFailed,
  linkDevice,
  linkedHosts,
  readLink,
  secureRelayUrl,
} from "./link.ts";

export { OPEN_TIMEOUT_MS, openSession, relaySessionTransport } from "./session.ts";

export { RelaySocket, type RelaySocketOptions } from "./socket.ts";
