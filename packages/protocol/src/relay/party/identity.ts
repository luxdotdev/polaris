// oxlint-disable-next-line typescript/triple-slash-reference -- noise-handshake and sodium-universal ship no types; this carries them into every consumer.
/// <reference path="./vendor.d.ts" />
/**
 * A party's relay identity: the Ed25519 key it proves to the relay. Separate from
 * its Noise static key, so the relay never learns the key the end-to-end channel uses.
 */
import {
  crypto_sign_BYTES,
  crypto_sign_detached,
  crypto_sign_keypair,
  crypto_sign_PUBLICKEYBYTES,
  crypto_sign_SECRETKEYBYTES,
  crypto_sign_seed_keypair,
} from "sodium-universal";
import {
  authMessage,
  type PushEnvironment,
  type PushTicket,
  pushTicketMessage,
  relayAddress,
  type RelayAddress,
  type RelayRole,
  toBase64Url,
} from "../wire.ts";

export interface RelayIdentity {
  readonly publicKey: Uint8Array;
  /** libsodium's 64-byte Ed25519 secret key (seed then public key). */
  readonly secretKey: Uint8Array;
}

export const generateRelayIdentity = (): RelayIdentity => {
  const publicKey = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  const secretKey = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  crypto_sign_keypair(publicKey, secretKey);

  return { publicKey, secretKey };
};

/** The relay identity a 32-byte seed always gives: both sides of a link derive the same one. */
export const relayIdentityFromSeed = (seed: Uint8Array): RelayIdentity => {
  const publicKey = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  const secretKey = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  crypto_sign_seed_keypair(publicKey, secretKey, seed);

  return { publicKey, secretKey };
};

export const signEd25519 = (identity: RelayIdentity, message: Uint8Array): Uint8Array => {
  const signature = new Uint8Array(crypto_sign_BYTES);
  crypto_sign_detached(signature, message, identity.secretKey);

  return signature;
};

/** The proof for the relay's challenge `nonce`: a signature over `authMessage(nonce, role)`. */
export const proveRelayKey = (
  identity: RelayIdentity,
  nonce: Uint8Array,
  role: RelayRole
): Uint8Array => signEd25519(identity, authMessage(nonce, role));

export const addressOf = (identity: RelayIdentity): Promise<RelayAddress> =>
  relayAddress(identity.publicKey);

/** A device's consent for the Host at `hostAddress` to wake it at `token` (wire.ts: PushTicket). */
export const signPushTicket = (
  identity: RelayIdentity,
  hostAddress: RelayAddress,
  environment: PushEnvironment,
  token: string
): PushTicket => ({
  key: toBase64Url(identity.publicKey),
  sig: toBase64Url(signEd25519(identity, pushTicketMessage(hostAddress, environment, token))),
});
