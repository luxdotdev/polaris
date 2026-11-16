/**
 * Where the Desktop App keeps its Polaris accounts: `<userData>/accounts/accounts.json` (nothing
 * secret) and each session token in `SecureStorage` as `accounts/tokens/<id>`.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AccountsError, type AccountStore, decodeAccountsFile } from "@polaris/client/accounts";
import { Effect, Option } from "effect";
import type { SecureStorageApi } from "../secure/index.ts";

const tokenKey = (id: string) => `accounts/tokens/${id}`;

const storageError = (cause: unknown) =>
  new AccountsError({
    reason: "storage",
    message: cause instanceof Error ? cause.message : String(cause),
  });

export const desktopAccountStore = (dir: string, storage: SecureStorageApi): AccountStore => {
  const path = join(dir, "accounts.json");

  const failed = (error: { readonly message: string }) => storageError(error.message);

  return {
    available: storage.available,
    read: Effect.promise(() => readFile(path, "utf8").catch(() => "")).pipe(
      Effect.map(decodeAccountsFile)
    ),
    write: (file) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await writeFile(`${path}.part`, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
          await rename(`${path}.part`, path);
        },
        catch: storageError,
      }),
    token: (id) =>
      storage.get(tokenKey(id)).pipe(
        Effect.mapError(failed),
        Effect.map((token) => Option.filter(token, (t) => t !== ""))
      ),
    setToken: (id, token) => storage.set(tokenKey(id), token).pipe(Effect.mapError(failed)),
    deleteToken: (id) => Effect.ignore(storage.delete(tokenKey(id))),
  };
};
