/**
 * A Linked Device: its keys, one socket per relay its Hosts use, and a transport per
 * Host. Sockets open on first use and stay open, so presence is known when the
 * Connection State reconnects; `close` ends them all (e.g. when the app goes away).
 */
import { type ByteTransport, TransportError } from "@polaris/protocol";
import { fromBase64Url, type RelayAddress, relayAddress } from "@polaris/protocol/relay";
import {
  generateRelayIdentity,
  generateStaticKeyPair,
  relayIdentityFromSeed,
  type RelayIdentity,
  type StaticKeyPair,
  staticKeyPairFromSecret,
} from "@polaris/protocol/relay/party";
import { Effect, Option, type Scope } from "effect";
import { relaySessionTransport } from "./session.ts";
import { RelaySocket } from "./socket.ts";

/** A Host this device is linked to, as the link string named it. Public facts only. */
export interface LinkedHost {
  readonly hostId: string;
  readonly hostName: string;
  readonly relayUrl: string;
  readonly hostAddress: RelayAddress;
  /** The Host's Noise static public key, base64url. */
  readonly hostNoiseKey: string;
}

/** The device's two secrets: what the Keychain keeps. */
export interface DeviceSecrets {
  /** 32-byte Ed25519 seed of the relay identity. */
  readonly identitySeed: Uint8Array;
  /** 32-byte X25519 secret of the Noise static key. */
  readonly noiseSecret: Uint8Array;
}

export interface DeviceKeys {
  readonly identity: RelayIdentity;
  readonly noise: StaticKeyPair;
  /** This device's relay address, derived from its identity. */
  readonly address: RelayAddress;
}

/** Fresh secrets for a device that has never linked. */
export const generateDeviceSecrets = (): DeviceSecrets => ({
  // libsodium's Ed25519 secret key starts with its seed.
  identitySeed: generateRelayIdentity().secretKey.slice(0, 32),
  noiseSecret: generateStaticKeyPair().secretKey.slice(),
});

export const deviceKeys = async (secrets: DeviceSecrets): Promise<DeviceKeys> => {
  const identity = relayIdentityFromSeed(secrets.identitySeed);

  return {
    identity,
    noise: staticKeyPairFromSecret(secrets.noiseSecret.slice()),
    address: await relayAddress(identity.publicKey),
  };
};

export interface RelayDevice {
  readonly keys: DeviceKeys;
  /** One connection's bytes to `host`: S4's HostTransport `open`. */
  readonly transport: (
    host: LinkedHost
  ) => Effect.Effect<ByteTransport, TransportError, Scope.Scope>;
  readonly close: () => void;
}

export interface RelayDeviceOptions {
  /** For tests: a fixed reconnect backoff. */
  readonly backoff?: ((attempt: number) => number) | undefined;
}

export const makeRelayDevice = (
  keys: DeviceKeys,
  options: RelayDeviceOptions = {}
): RelayDevice => {
  const sockets = new Map<string, RelaySocket>();

  const socketFor = (url: string) => {
    const existing = sockets.get(url);

    if (existing !== undefined) return existing;

    const socket = new RelaySocket({
      url,
      identity: keys.identity,
      reconnect: true,
      backoff: options.backoff,
    });

    sockets.set(url, socket);

    return socket;
  };

  return {
    keys,
    transport: (host) =>
      Effect.suspend(() => {
        const noiseKey = Option.getOrNull(fromBase64Url(host.hostNoiseKey));

        if (noiseKey === null)
          return Effect.fail(new TransportError({ message: "the Host's Noise key is malformed" }));

        return relaySessionTransport(
          socketFor(host.relayUrl),
          { address: host.hostAddress, noiseKey },
          keys.noise
        );
      }),
    close: () => {
      for (const socket of sockets.values()) socket.stop();
      sockets.clear();
    },
  };
};
