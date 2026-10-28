/**
 * The Host's two relay keys (apps/relay/README.md: Keys): the Ed25519 relay identity
 * it proves to the relay and the X25519 Noise static key Linked Devices pin. Both
 * secrets live in HostSecrets (the Keychain on a Mac), made on first use.
 */
import { randomBytes } from "node:crypto";
import { type RelayAddress, relayAddress } from "@polaris/protocol/relay";
import {
  type RelayIdentity,
  relayIdentityFromSeed,
  type StaticKeyPair,
  staticKeyPairFromSecret,
} from "@polaris/protocol/relay/party";
import { Effect, Option, Redacted } from "effect";
import { HostSecrets } from "../secrets/index.ts";

export interface HostRelayKeys {
  readonly identity: RelayIdentity;
  readonly address: RelayAddress;
  readonly noise: StaticKeyPair;
}

const IDENTITY_SEED = "relay/identity-seed";

const NOISE_SECRET = "relay/noise-secret";

/** The 32-byte secret stored under `key`, made and stored when missing. */
const secret = (key: string) =>
  Effect.gen(function* () {
    const secrets = yield* HostSecrets;
    const stored = yield* secrets.get(key);
    const decoded = Option.map(stored, (value) => Buffer.from(Redacted.value(value), "base64url"));

    if (Option.isSome(decoded) && decoded.value.byteLength === 32)
      return new Uint8Array(decoded.value);
    const fresh = randomBytes(32);
    yield* secrets.set(key, Redacted.make(fresh.toString("base64url")));

    return new Uint8Array(fresh);
  });

export const loadHostRelayKeys = Effect.gen(function* () {
  const identity = relayIdentityFromSeed(yield* secret(IDENTITY_SEED));
  const noise = staticKeyPairFromSecret(yield* secret(NOISE_SECRET));
  const address = yield* Effect.promise(() => relayAddress(identity.publicKey));

  return { identity, address, noise } satisfies HostRelayKeys;
});
