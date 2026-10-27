/** The relay's settings, from the environment (README: Configuration). */
import { Config } from "effect";
import type { GateLimits } from "./limits.ts";

export interface RelayConfig extends GateLimits {
  readonly port: number;
  readonly hostname: string;
  /** Read the client's address from the first `X-Forwarded-For` hop (behind Railway's proxy). */
  readonly trustProxy: boolean;
  readonly maxPeers: number;
  readonly messagesPerSecond: number;
  readonly bytesPerSecond: number;
  readonly authTimeoutMs: number;
  /** Seconds without traffic (pongs count) before a socket is closed; Bun pings in between. */
  readonly idleTimeoutSeconds: number;
  /** Bytes queued to a slow receiver before the relay closes it. */
  readonly backpressureLimitBytes: number;
}

export const defaultRelayConfig: RelayConfig = {
  port: 8080,
  hostname: "0.0.0.0",
  trustProxy: false,
  maxConnections: 10_000,
  maxConnectionsPerIp: 32,
  connectsPerSecondPerIp: 1,
  connectBurstPerIp: 20,
  maxPeers: 64,
  messagesPerSecond: 500,
  bytesPerSecond: 8 * 1024 * 1024,
  authTimeoutMs: 10_000,
  idleTimeoutSeconds: 60,
  backpressureLimitBytes: 16 * 1024 * 1024,
};

const int = (name: string, fallback: number) => Config.Int(name).pipe(Config.withDefault(fallback));

const d = defaultRelayConfig;

export const relayConfig: Config.Config<RelayConfig> = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(d.port)),
  hostname: Config.String("POLARIS_RELAY_HOSTNAME").pipe(Config.withDefault(d.hostname)),
  trustProxy: Config.Boolean("POLARIS_RELAY_TRUST_PROXY").pipe(Config.withDefault(d.trustProxy)),
  maxConnections: int("POLARIS_RELAY_MAX_CONNECTIONS", d.maxConnections),
  maxConnectionsPerIp: int("POLARIS_RELAY_MAX_CONNECTIONS_PER_IP", d.maxConnectionsPerIp),
  connectsPerSecondPerIp: int("POLARIS_RELAY_CONNECTS_PER_SECOND_PER_IP", d.connectsPerSecondPerIp),
  connectBurstPerIp: int("POLARIS_RELAY_CONNECT_BURST_PER_IP", d.connectBurstPerIp),
  maxPeers: int("POLARIS_RELAY_MAX_PEERS", d.maxPeers),
  messagesPerSecond: int("POLARIS_RELAY_MESSAGES_PER_SECOND", d.messagesPerSecond),
  bytesPerSecond: int("POLARIS_RELAY_BYTES_PER_SECOND", d.bytesPerSecond),
  authTimeoutMs: int("POLARIS_RELAY_AUTH_TIMEOUT_MS", d.authTimeoutMs),
  idleTimeoutSeconds: int("POLARIS_RELAY_IDLE_TIMEOUT_SECONDS", d.idleTimeoutSeconds),
  backpressureLimitBytes: int("POLARIS_RELAY_BACKPRESSURE_LIMIT_BYTES", d.backpressureLimitBytes),
});
