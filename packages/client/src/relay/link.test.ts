import { describe, expect, test } from "bun:test";
import { encodeLinkEnvelope, HostId, type SharedHost } from "@polaris/protocol";
import { relayAddress } from "@polaris/protocol/relay";
import { Effect } from "effect";
import { checkLinkedHosts, type LinkFailed, readLink } from "./link.ts";

const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const key = () => Buffer.from(bytes(32)).toString("base64url");

const host = async (hostName: string, relayUrl: string): Promise<SharedHost> => ({
  hostId: HostId.make(crypto.randomUUID()),
  hostName,
  relayUrl,
  hostAddress: await relayAddress(bytes(32)),
  hostNoiseKey: key(),
});

const linkString = async (linkRelay: string, otherRelay: string) =>
  encodeLinkEnvelope({
    link: {
      ...(await host("MacBook Pro", linkRelay)),
      secret: key(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    hosts: [await host("Raspberry Pi", otherRelay)],
  });

const failure = <A>(effect: Effect.Effect<A, LinkFailed>) =>
  Effect.runSync(Effect.match(effect, { onSuccess: () => null, onFailure: (e) => e.reason }));

describe("readLink", () => {
  test.each<[string, string, LinkFailed["reason"] | null]>([
    ["wss://relay.polaris.lux.dev/v1", "wss://self.example/v1", null],
    ["ws://127.0.0.1:8197/v1", "ws://localhost:8197/v1", null],
    ["ws://relay.polaris.lux.dev/v1", "wss://self.example/v1", "insecure-relay"],
    ["wss://relay.polaris.lux.dev/v1", "http://self.example/v1", "insecure-relay"],
    ["wss://relay.polaris.lux.dev/v1", "ws://192.168.1.4/v1", "insecure-relay"],
  ])("a link through %s sharing a Host on %s fails with %p", async (link, other, reason) => {
    expect(failure(readLink(await linkString(link, other)))).toBe(reason);
  });
});

describe("checkLinkedHosts", () => {
  test("a Host linked again with the same keys is accepted; another key or address is refused", async () => {
    const known = await host("MacBook Pro", "wss://relay.polaris.lux.dev/v1");
    const other = await host("Raspberry Pi", "wss://relay.polaris.lux.dev/v1");

    expect(failure(checkLinkedHosts([known], [known, other]))).toBeNull();
    expect(failure(checkLinkedHosts([known], [{ ...known, hostNoiseKey: key() }]))).toBe(
      "host-changed"
    );
    expect(failure(checkLinkedHosts([known], [{ ...known, hostAddress: other.hostAddress }]))).toBe(
      "host-changed"
    );
  });
});
