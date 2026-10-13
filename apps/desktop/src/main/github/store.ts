/**
 * What the GitHub client keeps: `<userData>/github/accounts.json` (logins, order,
 * routing; nothing secret) and each account's tokens in `SecureStorage` as `github/tokens/<id>`.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { GITHUB_HOST } from "../../shared/github.ts";
import type { Adoption, SecureStorageApi } from "../secure/index.ts";
import { GitHubStorageError } from "./errors.ts";

const tokenKey = (id: number) => `github/tokens/${id}`;

/** Where tokens were sealed before `SecureStorage`: `<userData>/github/tokens/<id>.bin`. */
export const legacyTokens = (userData: string): Adoption => ({
  from: join(userData, "github", "tokens"),
  prefix: "github/tokens",
});

const orNull = Schema.NullOr(Schema.Number).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null))
);

export const AccountRecord = Schema.Struct({
  /** Polaris's key: the user id on github.com, a negative number on other hosts. */
  id: Schema.Number,
  /** github.com, or a GitHub Enterprise host; records from before GHE are github.com's. */
  host: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(GITHUB_HOST))),
  /** The user id on its host; null means the same as `id` (github.com). */
  userId: orNull,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.String,
  scopes: Schema.Array(Schema.String),
  signedOut: Schema.Boolean,
  signedInAt: orNull,
  signedOutAt: orNull,
});

export type AccountRecord = typeof AccountRecord.Type;

/** A GitHub Enterprise host the user added, with the OAuth App its admins registered. */
export const HostRecord = Schema.Struct({ host: Schema.String, clientId: Schema.String });

export type HostRecord = typeof HostRecord.Type;

export const AccountsFile = Schema.Struct({
  hosts: Schema.Array(HostRecord).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** In the user's order. */
  accounts: Schema.Array(AccountRecord),
  owners: Schema.Record(Schema.String, Schema.Number),
  workspaces: Schema.Record(Schema.String, Schema.Number),
});

export type AccountsFile = typeof AccountsFile.Type;

export const EMPTY_ACCOUNTS: AccountsFile = { hosts: [], accounts: [], owners: {}, workspaces: {} };

/** The account's id on its own host. */
export const userIdOf = (account: AccountRecord) => account.userId ?? account.id;

/** One account's tokens. Expiring tokens last 8 hours; their refresh token 6 months. */
export const TokenPair = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  /** Epoch ms; null for a token that doesn't expire. */
  expiresAt: Schema.NullOr(Schema.Number),
  refreshExpiresAt: Schema.NullOr(Schema.Number),
});

export type TokenPair = typeof TokenPair.Type;

const decodeAccounts = Schema.decodeUnknownOption(Schema.fromJsonString(AccountsFile));

const decodeTokens = Schema.decodeUnknownEffect(Schema.fromJsonString(TokenPair));

const storageError = (cause: unknown) => new GitHubStorageError({ message: String(cause) });

const failed = (error: { readonly message: string }) =>
  new GitHubStorageError({ message: error.message });

/** Writes through a temporary file, so a crash never leaves half a record. */
const writeAtomically = (path: string, data: string) =>
  Effect.tryPromise({
    try: async () => {
      await writeFile(`${path}.part`, data, { mode: 0o600 });
      await rename(`${path}.part`, path);
    },
    catch: storageError,
  });

export interface StoreInput {
  readonly dir: string;
  readonly storage: SecureStorageApi;
}

export const openStore = ({ dir, storage }: StoreInput) => {
  const accountsPath = join(dir, "accounts.json");

  const ready = Effect.tryPromise({
    try: () => mkdir(dir, { recursive: true, mode: 0o700 }),
    catch: storageError,
  });

  const readAccounts = Effect.promise(() => readFile(accountsPath, "utf8").catch(() => "")).pipe(
    Effect.map((text) => Option.getOrElse(decodeAccounts(text), () => EMPTY_ACCOUNTS))
  );

  const writeAccounts = (file: AccountsFile) =>
    Effect.andThen(ready, writeAtomically(accountsPath, `${JSON.stringify(file, null, 2)}\n`));

  const writeTokens = (id: number, tokens: TokenPair) =>
    storage.set(tokenKey(id), JSON.stringify(tokens)).pipe(Effect.mapError(failed));

  /** None when the account has no stored tokens (removed, or never stored). */
  const readTokens = (id: number) =>
    storage.get(tokenKey(id)).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<TokenPair>()),
          onSome: (text) => Effect.map(decodeTokens(text), Option.some),
        })
      ),
      Effect.mapError(failed)
    );

  const removeTokens = (id: number) => Effect.ignore(storage.delete(tokenKey(id)));

  return {
    available: storage.available,
    readAccounts,
    writeAccounts,
    readTokens,
    writeTokens,
    removeTokens,
  };
};

export type Store = ReturnType<typeof openStore>;
