/** Polaris accounts' store on this iPhone: the list (nothing secret) and each session token. */
import {
  type AccountsFile,
  AccountsError,
  type AccountStore,
  decodeAccountsFile,
} from "@polaris/client/accounts";
import { Effect, Option } from "effect";

const LIST = "polaris.accounts.list";

const tokenKey = (id: string) => `polaris.accounts.token.${id}`;

/** The few Keychain calls the store makes; the app passes expo-secure-store (`keychain.ts`). */
export interface Keychain {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

const refused = (cause: unknown) =>
  new AccountsError({
    reason: "storage",
    message: `the Keychain refused: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: refused });

export const keychainAccountStore = (keychain: Keychain): AccountStore => ({
  available: Effect.succeed(true),
  read: Effect.map(
    attempt(() => keychain.get(LIST)),
    (text) => decodeAccountsFile(text ?? "")
  ),
  write: (file: AccountsFile) => attempt(() => keychain.set(LIST, JSON.stringify(file))),
  token: (id) =>
    Effect.map(
      attempt(() => keychain.get(tokenKey(id))),
      Option.fromNullOr
    ),
  setToken: (id, token) => attempt(() => keychain.set(tokenKey(id), token)),
  deleteToken: (id) => Effect.ignore(attempt(() => keychain.delete(tokenKey(id)))),
});
