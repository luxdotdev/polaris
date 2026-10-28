import { expect, test } from "bun:test";
import { Option } from "effect";
import {
  decodeLinkRequest,
  decodeLinkString,
  encodeLinkRequest,
  encodeLinkString,
} from "../../linkedDevices.ts";
import { HostId } from "../../ids.ts";
import { relayAddress } from "../wire.ts";
import { acceptHandshake, generateStaticKeyPair, RelayInitiator } from "./channel.ts";
import { generateRelayIdentity } from "./identity.ts";
import { linkIdentity, linkProof, sameProof } from "./link.ts";

const secret = () => crypto.getRandomValues(new Uint8Array(32));

test("both sides derive the same link address from the secret, and another secret gives another", async () => {
  const shared = secret();
  const host = await relayAddress(linkIdentity(shared).publicKey);
  const device = await relayAddress(linkIdentity(shared.slice()).publicKey);

  expect(device).toBe(host);
  expect(await relayAddress(linkIdentity(secret()).publicKey)).not.toBe(host);
});

test("a link proof binds the secret, the device's Noise key and its relay address", async () => {
  const shared = secret();
  const noise = generateStaticKeyPair().publicKey;
  const address = await relayAddress(generateRelayIdentity().publicKey);
  const proof = linkProof(shared, noise, address);

  expect(sameProof(proof, linkProof(shared, noise, address))).toBe(true);
  expect(sameProof(proof, linkProof(secret(), noise, address))).toBe(false);
  expect(sameProof(proof, linkProof(shared, generateStaticKeyPair().publicKey, address))).toBe(
    false
  );

  const other = await relayAddress(generateRelayIdentity().publicKey);
  expect(sameProof(proof, linkProof(shared, noise, other))).toBe(false);
});

test("the link request travels inside the handshake init, readable only by the host", async () => {
  const host = generateStaticKeyPair();
  const device = generateStaticKeyPair();
  const address = await relayAddress(generateRelayIdentity().publicKey);
  const request = encodeLinkRequest({ v: 1, address, name: "Phone", proof: "A".repeat(43) });
  const initiator = new RelayInitiator(device, host.publicKey, new TextEncoder().encode(request));
  let received = "";

  acceptHandshake(host, initiator.init, (_, payload) => {
    received = new TextDecoder().decode(payload);

    return true;
  });

  expect(Option.getOrThrow(decodeLinkRequest(received)).address).toBe(address);
  expect(new TextDecoder().decode(initiator.init)).not.toContain(address);
});

test("a link string round-trips and other text is not one", async () => {
  const payload = {
    hostId: HostId.make("h1"),
    hostName: "studio",
    relayUrl: "wss://relay.example/v1",
    hostAddress: await relayAddress(generateRelayIdentity().publicKey),
    hostNoiseKey: "B".repeat(43),
    secret: "C".repeat(43),
    expiresAt: "2026-10-27T00:00:00.000Z",
  };

  expect(Option.getOrThrow(decodeLinkString(` ${encodeLinkString(payload)}\n`))).toEqual(payload);
  expect(Option.isNone(decodeLinkString("polaris-pair:v1:abc"))).toBe(true);
});
