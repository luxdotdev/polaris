// oxlint-disable-next-line typescript/triple-slash-reference -- noise-handshake and sodium-universal ship no types; this carries them into every consumer.
/// <reference path="./vendor.d.ts" />
/**
 * Linking a device over the relay (ADR 0083). The link string's secret gives both sides
 * the same throwaway relay identity, which the host lists as a peer until the link is
 * used, and a proof the device sends inside its handshake init, so the relay can't link one.
 */
import { crypto_generichash } from "sodium-universal";
import { relayIdentityFromSeed, type RelayIdentity } from "./identity.ts";

const encoder = new TextEncoder();

const IDENTITY_CONTEXT = encoder.encode("polaris-link/1 identity");

const PROOF_CONTEXT = encoder.encode("polaris-link/1 proof\0");

export const LINK_SECRET_BYTES = 32;

const keyedHash = (key: Uint8Array, ...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const input = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    input.set(part, offset);
    offset += part.byteLength;
  }

  const out = new Uint8Array(32);
  crypto_generichash(out, input, key);

  return out;
};

/** The relay identity a linking device dials with; the host lists its address while the link is open. */
export const linkIdentity = (secret: Uint8Array): RelayIdentity =>
  relayIdentityFromSeed(keyedHash(secret, IDENTITY_CONTEXT));

/** Binds the secret to the device's Noise key and the relay address it will use once linked. */
export const linkProof = (
  secret: Uint8Array,
  deviceNoiseKey: Uint8Array,
  deviceAddress: string
): Uint8Array => keyedHash(secret, PROOF_CONTEXT, deviceNoiseKey, encoder.encode(deviceAddress));

/** Constant-time equality for proofs. */
export const sameProof = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;

  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);

  return diff === 0;
};
