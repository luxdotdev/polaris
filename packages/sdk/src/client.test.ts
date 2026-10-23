import { expect, test } from "bun:test";
import { mergeHosts } from "./client.ts";
import { protocolMismatch } from "./connection.ts";
import type { ParsedPairing } from "./pairing.ts";
import { SUPPORTED_PROTOCOL } from "./version.ts";

const pairing = (hostId: string, url: string | null, name: string): ParsedPairing => ({
  hostId,
  hostName: `Host ${hostId}`,
  url,
  token: `pol_ext_${name}`,
  name,
});

test("pairings for one Host merge into one entry, tried in the order given", () => {
  const hosts = mergeHosts([
    pairing("a", null, "local"),
    pairing("b", "wss://b.ts.net/polaris/rpc", "b"),
    pairing("a", "ws://127.0.0.1:7477/polaris/rpc", "gateway"),
  ]);

  expect(hosts.map((host) => [host.hostId, host.pairings.map((p) => p.name)])).toEqual([
    ["a", ["local", "gateway"]],
    ["b", ["b"]],
  ]);
});

test("a protocol outside the SDK's range names the side to update", () => {
  expect(protocolMismatch(SUPPORTED_PROTOCOL.max)).toBeNull();
  expect(protocolMismatch(SUPPORTED_PROTOCOL.min - 1)?.update).toBe("polaris");
  expect(protocolMismatch(SUPPORTED_PROTOCOL.max + 1)?.message).toContain("update the Extension");
});
