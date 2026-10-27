/** Starts an in-process relay on a free port with small limits, collecting its wide events. */
import { type RelayAddress, toBase64Url } from "@polaris/protocol/relay";
import {
  addressOf,
  generateRelayIdentity,
  type RelayIdentity,
} from "@polaris/protocol/relay/party";
import { defaultRelayConfig, type RelayConfig } from "../config.ts";
import { type RelayHandle, startRelay } from "../server.ts";
import type { WideEvent } from "../wideEvent.ts";

export interface TestRelay extends RelayHandle {
  readonly url: string;
  readonly events: Array<WideEvent>;
}

export const testConfig: RelayConfig = {
  ...defaultRelayConfig,
  port: 0,
  hostname: "127.0.0.1",
  connectsPerSecondPerIp: 1_000,
  connectBurstPerIp: 1_000,
  maxConnectionsPerIp: 1_000,
  maxPeers: 4,
  messagesPerSecond: 100,
  authTimeoutMs: 1_000,
};

export const startTestRelay = (overrides: Partial<RelayConfig> = {}): TestRelay => {
  const events: Array<WideEvent> = [];
  const relay = startRelay({ ...testConfig, ...overrides }, (event) => events.push(event));

  return { ...relay, url: `ws://127.0.0.1:${relay.port}/v1`, events };
};

export interface Identified {
  readonly identity: RelayIdentity;
  readonly address: RelayAddress;
  /** Everything about the party a log line must never contain. */
  readonly secrets: ReadonlyArray<string>;
}

export const identify = async (): Promise<Identified> => {
  const identity = generateRelayIdentity();
  const address = await addressOf(identity);

  return { identity, address, secrets: [address, toBase64Url(identity.publicKey)] };
};
