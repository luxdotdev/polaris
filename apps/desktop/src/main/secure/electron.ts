/**
 * `SecureStorage`'s Electron side: `safeStorage` (async API) as the sealer, so records
 * are sealed by the Keychain on macOS, DPAPI on Windows, and libsecret or kwallet on Linux.
 * The only file that imports `safeStorage`.
 */
import { join } from "node:path";
import { safeStorage } from "electron";
import { type Adoption, backendOf, SecureStorage, type Sealer } from "./index.ts";

export const safeStorageSealer: Sealer = {
  backend: async () =>
    backendOf({
      encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
      platform: process.platform,
      selectedBackend: () => safeStorage.getSelectedStorageBackend(),
    }),
  seal: async (plain) => new Uint8Array(await safeStorage.encryptStringAsync(plain)),
  open: async (sealed) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(sealed));

    return { text: result, shouldReEncrypt };
  },
};

/** `<userData>/secure/<namespace>/…/<name>.bin`, adopting older records first. */
export const secureStorageLayer = (userData: string, adopt: ReadonlyArray<Adoption> = []) =>
  SecureStorage.files({ dir: join(userData, "secure"), sealer: safeStorageSealer, adopt });
