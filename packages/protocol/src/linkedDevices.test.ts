import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { HostId } from "./ids.ts";
import {
  decodeLinkString,
  encodeLinkEnvelope,
  encodeLinkString,
  type LinkEnvelope,
  type SharedHost,
} from "./linkedDevices.ts";
import { relayAddress } from "./relay/wire.ts";

const RELAY = "wss://relay.polaris.lux.dev/v1";

const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const key = () => Buffer.from(bytes(32)).toString("base64url");

const host = async (name: string, relayUrl = RELAY): Promise<SharedHost> => ({
  hostId: HostId.make(crypto.randomUUID()),
  hostName: name,
  relayUrl,
  hostAddress: await relayAddress(bytes(32)),
  hostNoiseKey: key(),
});

const envelope = async (others: number): Promise<LinkEnvelope> => ({
  link: {
    ...(await host("MacBook Pro")),
    secret: key(),
    expiresAt: new Date(Date.UTC(2026, 9, 27, 12, 5)).toISOString(),
  },
  hosts: await Promise.all(Array.from({ length: others }, (_, i) => host(`Raspberry Pi ${i}`))),
});

describe("link strings", () => {
  test("a v2 string round-trips its link and every shared Host, including other relays", async () => {
    const value = await envelope(2);
    const linuxVm = await host("Linux VM", "wss://self/v1");
    const elsewhere = { ...value, hosts: [...value.hosts, linuxVm] };

    expect(Option.getOrThrow(decodeLinkString(` ${encodeLinkEnvelope(elsewhere)}\n`))).toEqual(
      elsewhere
    );
  });

  test("a v1 string still decodes, with no other Hosts", async () => {
    const { link } = await envelope(0);

    expect(Option.getOrThrow(decodeLinkString(encodeLinkString(link)))).toEqual({
      link,
      hosts: [],
    });
  });

  test("six Hosts fit a QR code that scans easily (at most version 22 at level L)", async () => {
    // Version 22, level L, byte mode holds 1,030 bytes; JSON took 1,942 here.
    expect(encodeLinkEnvelope(await envelope(5)).length).toBeLessThanOrEqual(1030);
  });

  test("a cut, padded or foreign string is not a link", async () => {
    const text = encodeLinkEnvelope(await envelope(1));

    expect(Option.isNone(decodeLinkString(text.slice(0, -4)))).toBe(true);
    expect(Option.isNone(decodeLinkString(`${text}AAAA`))).toBe(true);
    expect(Option.isNone(decodeLinkString("polaris-pair:v1:abc"))).toBe(true);
    expect(Option.isNone(decodeLinkString("polaris-link:v2:!!"))).toBe(true);
  });

  test("a key of the wrong size can't be encoded", async () => {
    const value = await envelope(0);

    expect(() =>
      encodeLinkEnvelope({ ...value, link: { ...value.link, hostNoiseKey: "AAAA" } })
    ).toThrow(RangeError);
  });
});
