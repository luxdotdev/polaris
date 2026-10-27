/** The development pairing string, kept in the Keychain: it carries an Extension token. */
import * as SecureStore from "expo-secure-store";

const KEY = "polaris.dev.pairing";

export const loadPairing = (): Promise<string | null> => SecureStore.getItemAsync(KEY);

export const savePairing = (pairing: string): Promise<void> =>
  pairing.trim() === ""
    ? SecureStore.deleteItemAsync(KEY)
    : SecureStore.setItemAsync(KEY, pairing.trim());
