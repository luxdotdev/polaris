/**
 * The device's relay identity and Noise secret, and the Hosts it linked, in the Keychain:
 * this device only, readable once unlocked, never in a backup. Ed25519 and X25519 keys
 * can't live in the Secure Enclave (it holds P-256 only), so the Keychain is as far as they go.
 */
import { type DeviceSecrets, generateDeviceSecrets, type LinkedHost } from "@polaris/client/relay";
import { SharedHost } from "@polaris/protocol";
import { fromBase64Url, toBase64Url } from "@polaris/protocol/relay";
import { Option, Schema } from "effect";
import * as SecureStore from "expo-secure-store";

const IDENTITY = "polaris.relay.identity-seed";

const NOISE = "polaris.relay.noise-secret";

const HOSTS = "polaris.relay.hosts";

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const decodeHosts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(SharedHost)));

const readKey = async (name: string): Promise<Uint8Array | null> => {
  const text = await SecureStore.getItemAsync(name, options);

  return text === null ? null : Option.getOrNull(fromBase64Url(text));
};

/** The secrets this device proves itself with, or null before its first link. */
export const loadSecrets = async (): Promise<DeviceSecrets | null> => {
  const [identitySeed, noiseSecret] = await Promise.all([readKey(IDENTITY), readKey(NOISE)]);

  return identitySeed?.byteLength === 32 && noiseSecret?.byteLength === 32
    ? { identitySeed, noiseSecret }
    : null;
};

/** The stored secrets, or new ones (not saved until a link succeeds). */
export const secretsForLinking = async (): Promise<DeviceSecrets> =>
  (await loadSecrets()) ?? generateDeviceSecrets();

export const loadHosts = async (): Promise<ReadonlyArray<LinkedHost>> => {
  const text = await SecureStore.getItemAsync(HOSTS, options);

  return text === null ? [] : Option.getOrElse(decodeHosts(text), () => []);
};

/** Keeps the secrets and adds `hosts` to the linked ones (a Host linked again is replaced). */
export const saveLink = async (
  secrets: DeviceSecrets,
  hosts: ReadonlyArray<LinkedHost>
): Promise<ReadonlyArray<LinkedHost>> => {
  const added = new Set(hosts.map((host) => host.hostId));
  const all = [...(await loadHosts()).filter((host) => !added.has(host.hostId)), ...hosts];

  await SecureStore.setItemAsync(IDENTITY, toBase64Url(secrets.identitySeed), options);
  await SecureStore.setItemAsync(NOISE, toBase64Url(secrets.noiseSecret), options);
  await SecureStore.setItemAsync(HOSTS, JSON.stringify(all), options);

  return all;
};

/** Keeps only `hosts` linked: those that haven't revoked this device yet (RX1-3). */
export const keepHosts = async (hosts: ReadonlyArray<LinkedHost>): Promise<void> => {
  await SecureStore.setItemAsync(HOSTS, JSON.stringify(hosts), options);
};

/** Forgets every linked Host and the keys, so the next link starts as a new device. */
export const forgetLink = async (): Promise<void> => {
  await Promise.all(
    [IDENTITY, NOISE, HOSTS].map((key) => SecureStore.deleteItemAsync(key, options))
  );
};
