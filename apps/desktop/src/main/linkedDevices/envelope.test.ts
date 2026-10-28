import { describe, expect, test } from "bun:test";
import { decodeLinkString, encodeLinkString, HostId } from "@polaris/protocol";
import { relayAddress } from "@polaris/protocol/relay";
import { Option } from "effect";
import { linkEnvelope, type RelayHost } from "./envelope.ts";

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const host = async (
  label: string,
  route: Partial<RelayHost["route"]> = {}
): Promise<RelayHost> => ({
  key: label.toLowerCase(),
  label,
  hostId: HostId.make(crypto.randomUUID()),
  route: {
    state: "on",
    url: "wss://relay.example/v1",
    connected: true,
    hostAddress: await relayAddress(crypto.getRandomValues(new Uint8Array(32))),
    hostNoiseKey: key(),
    ...route,
  },
});

const offer = (through: RelayHost) =>
  encodeLinkString({
    hostId: through.hostId,
    hostName: "studio.local",
    relayUrl: through.route.url ?? "",
    hostAddress: through.route.hostAddress,
    hostNoiseKey: through.route.hostNoiseKey,
    secret: key(),
    expiresAt: "2026-10-27T12:05:00.000Z",
  });

describe("linkEnvelope", () => {
  test("carries the link and every other Host with the route on, by this app's names", async () => {
    const studio = await host("Mac Studio");
    const pi = await host("Raspberry Pi 4", { connected: false });
    const vm = await host("Linux VM", { state: "off" });
    const unset = await host("Old iMac", { url: null });
    const linkString = offer(studio);

    const envelope = Option.getOrThrow(
      decodeLinkString(Option.getOrThrow(linkEnvelope(linkString, studio, [studio, pi, vm, unset])))
    );

    expect(envelope.link).toEqual({
      ...Option.getOrThrow(decodeLinkString(linkString)).link,
      hostName: "Mac Studio",
    });
    expect(envelope.hosts.map((h) => [h.hostName, h.hostId, h.hostNoiseKey])).toEqual([
      ["Raspberry Pi 4", pi.hostId, pi.route.hostNoiseKey],
    ]);
  });

  test("text that isn't a link string gives none", async () => {
    expect(Option.isNone(linkEnvelope("polaris-pair:v1:x", await host("Mac Studio"), []))).toBe(
      true
    );
  });
});
