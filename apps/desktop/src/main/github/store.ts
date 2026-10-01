/**
 * What the GitHub client keeps on disk under `<userData>/github`: `accounts.json`
 * (logins, order, routing; nothing secret) and one encrypted token file per account,
 * sealed with Electron's `safeStorage` (the macOS keychain holds its key).
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { GitHubStorageError } from "./errors.ts";

/** `safeStorage`'s async API, or an in-memory stand-in in tests. */
export interface Crypto {
  readonly available: () => Promise<boolean>;
  readonly encrypt: (plain: string) => Promise<Uint8Array>;
  readonly decrypt: (sealed: Uint8Array) => Promise<Decrypted>;
}

export interface Decrypted {
  readonly text: string;
  /** The keychain key rotated: write the record again. */
  readonly shouldReEncrypt: boolean;
}

export const AccountRecord = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.String,
  scopes: Schema.Array(Schema.String),
  signedOut: Schema.Boolean,
});

export type AccountRecord = typeof AccountRecord.Type;

export const AccountsFile = Schema.Struct({
  /** In the user's order. */
  accounts: Schema.Array(AccountRecord),
  owners: Schema.Record(Schema.String, Schema.Number),
  workspaces: Schema.Record(Schema.String, Schema.Number),
});

export type AccountsFile = typeof AccountsFile.Type;

export const EMPTY_ACCOUNTS: AccountsFile = { accounts: [], owners: {}, workspaces: {} };

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

/** Writes through a temporary file, so a crash never leaves half a record. */
const writeAtomically = (path: string, data: string | Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      await writeFile(`${path}.part`, data, { mode: 0o600 });
      await rename(`${path}.part`, path);
    },
    catch: storageError,
  });

export interface StoreInput {
  readonly dir: string;
  readonly crypto: Crypto;
}

export const openStore = ({ dir, crypto }: StoreInput) => {
  const accountsPath = join(dir, "accounts.json");
  const tokenPath = (id: number) => join(dir, "tokens", `${id}.bin`);

  const ready = Effect.tryPromise({
    try: () => mkdir(join(dir, "tokens"), { recursive: true, mode: 0o700 }),
    catch: storageError,
  });

  const readAccounts = Effect.promise(() => readFile(accountsPath, "utf8").catch(() => "")).pipe(
    Effect.map((text) => Option.getOrElse(decodeAccounts(text), () => EMPTY_ACCOUNTS))
  );

  const writeAccounts = (file: AccountsFile) =>
    Effect.andThen(ready, writeAtomically(accountsPath, `${JSON.stringify(file, null, 2)}\n`));

  const writeTokens = (id: number, tokens: TokenPair) =>
    Effect.gen(function* () {
      yield* ready;

      const sealed = yield* Effect.tryPromise({
        try: () => crypto.encrypt(JSON.stringify(tokens)),
        catch: storageError,
      });

      yield* writeAtomically(tokenPath(id), sealed);
    });

  /** None when the account has no token file (removed, or never stored). */
  const readTokens = (id: number) =>
    Effect.gen(function* () {
      const sealed = yield* Effect.promise(() =>
        readFile(tokenPath(id)).then(
          (bytes) => Option.some(new Uint8Array(bytes)),
          () => Option.none<Uint8Array>()
        )
      );

      if (Option.isNone(sealed)) return Option.none<TokenPair>();

      const opened = yield* Effect.tryPromise({
        try: () => crypto.decrypt(sealed.value),
        catch: storageError,
      });

      const tokens = yield* decodeTokens(opened.text).pipe(Effect.mapError(storageError));

      if (opened.shouldReEncrypt) yield* writeTokens(id, tokens);

      return Option.some(tokens);
    });

  const removeTokens = (id: number) =>
    Effect.promise(() => rm(tokenPath(id), { force: true }).catch(() => undefined));

  return {
    available: Effect.promise(() => crypto.available().catch(() => false)),
    readAccounts,
    writeAccounts,
    readTokens,
    writeTokens,
    removeTokens,
  };
};

export type Store = ReturnType<typeof openStore>;
