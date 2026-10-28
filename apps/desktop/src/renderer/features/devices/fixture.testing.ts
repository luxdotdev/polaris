/** Hosts, Relay routes and Linked Devices for the Devices page's tests. */
import { LinkedDeviceId } from "@polaris/protocol";
import { relayAddress } from "@polaris/protocol/relay";
import type { HostView } from "../../../shared/api.ts";
import type { LinkedDeviceView, RelayRouteView } from "../../../shared/linkedDevicesContract.ts";

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const route = async (
  state: "on" | "off",
  connected = state === "on"
): Promise<RelayRouteView> => ({
  state,
  url: state === "on" ? "wss://relay.example/v1" : null,
  connected,
  hostAddress: await relayAddress(crypto.getRandomValues(new Uint8Array(32))),
  hostNoiseKey: key(),
});

/** One phone's record on one Host; the same `noiseKey` on two Hosts is one device. */
export const phone = async (
  over: Partial<LinkedDeviceView> & { readonly noiseKey: string }
): Promise<LinkedDeviceView> => ({
  id: LinkedDeviceId.make(`d-${crypto.randomUUID()}`),
  name: "Lucas's iPhone",
  relayAddress: await relayAddress(crypto.getRandomValues(new Uint8Array(32))),
  createdAt: "2026-10-20T12:00:00.000Z",
  lastUsedAt: null,
  unlinkedAt: null,
  ...over,
});

export const noiseKey = key;

export const host = (
  hostKey: string,
  label: string,
  state: HostView["status"]["state"] = "connected",
  capabilities: HostView["status"]["capabilities"] = ["linked-devices"]
): HostView => ({
  key: hostKey,
  label,
  colour: null,
  alias: null,
  kind: "ssh",
  proofHarness: false,
  status: {
    state,
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities,
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
});
