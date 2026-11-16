/**
 * What a Client keeps about its Accounts: a list with nothing secret (each Account's server,
 * person and commit email, and each Workspace's sharing Account), and each session token in
 * the platform's secret store. Each app gives its own `AccountStore`.
 */
import { Effect, Option, Schema } from "effect";
import type { AccountsError } from "./contract.ts";

export const AccountRecord = Schema.Struct({
  /** This device's key for the Account (lowercase hex), naming its token in the secret store. */
  id: Schema.String,
  /** The Account Server's origin, the issuer. */
  server: Schema.String,
  personId: Schema.String,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  commitEmail: Schema.String,
  commitEmails: Schema.Array(Schema.String),
  /** Epoch ms of the last sign-in. */
  signedInAt: Schema.Number,
  /** Epoch ms when the server refused the session; null while signed in. */
  signedOutAt: Schema.NullOr(Schema.Number),
});

export type AccountRecord = typeof AccountRecord.Type;

export const AccountsFile = Schema.Struct({
  /** In the order they were added. */
  accounts: Schema.Array(AccountRecord),
  /** A Workspace's key (`hostKey/workspaceId`) to the Account it is shared as. */
  workspaces: Schema.Record(Schema.String, Schema.String),
});

export type AccountsFile = typeof AccountsFile.Type;

export const EMPTY_ACCOUNTS: AccountsFile = { accounts: [], workspaces: {} };

export const decodeAccountsFile = (text: string): AccountsFile =>
  Option.getOrElse(
    Schema.decodeUnknownOption(Schema.fromJsonString(AccountsFile))(text),
    () => EMPTY_ACCOUNTS
  );

export interface AccountStore {
  /** Whether session tokens can be kept: false when the platform has no secret store. */
  readonly available: Effect.Effect<boolean>;
  readonly read: Effect.Effect<AccountsFile, AccountsError>;
  readonly write: (file: AccountsFile) => Effect.Effect<void, AccountsError>;
  readonly token: (id: string) => Effect.Effect<Option.Option<string>, AccountsError>;
  readonly setToken: (id: string, token: string) => Effect.Effect<void, AccountsError>;
  /** Succeeds when nothing was stored. */
  readonly deleteToken: (id: string) => Effect.Effect<void>;
}

/** In memory, for tests and previews. */
export const memoryAccountStore = (initial: AccountsFile = EMPTY_ACCOUNTS): AccountStore => {
  let file = initial;
  const tokens = new Map<string, string>();

  return {
    available: Effect.succeed(true),
    read: Effect.sync(() => file),
    write: (next) =>
      Effect.sync(() => {
        file = next;
      }),
    token: (id) => Effect.sync(() => Option.fromUndefinedOr(tokens.get(id))),
    setToken: (id, token) => Effect.sync(() => void tokens.set(id, token)),
    deleteToken: (id) => Effect.sync(() => void tokens.delete(id)),
  };
};
