/**
 * The Keychain behind Polaris accounts: this device only, readable once unlocked, never in a
 * backup, as the relay's secrets are (`../relay/store.ts`).
 */
import * as SecureStore from "expo-secure-store";
import type { Keychain } from "./store.ts";

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStoreKeychain: Keychain = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
};
