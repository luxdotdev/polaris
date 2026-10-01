/**
 * Access tokens per account, refreshed ahead of expiry and after a 401. GitHub
 * rotates both tokens on each refresh and voids the old pair, so refreshes are
 * serialized per account and the new pair is written before it is used.
 */
import { Clock, Effect, Option, Semaphore } from "effect";
import { GITHUB_CLIENT_ID } from "../../shared/github.ts";
import { GitHubAuthError, GitHubStorageError } from "./errors.ts";
import type { Store, TokenPair } from "./store.ts";
import type { Transport } from "./transport.ts";
import { TokenResponse } from "./wire.ts";

/** Refresh this long before the 8-hour token expires. */
export const REFRESH_AHEAD_MS = 30 * 60 * 1000;

export interface CredentialsInput {
  readonly store: Store;
  readonly transport: Transport;
  /** The refresh token is dead or missing: the account must sign in again. */
  readonly signedOut: (accountId: number) => Effect.Effect<void>;
}

export const tokenPairFrom = (response: TokenResponse, now: number): TokenPair | null =>
  response.access_token === undefined
    ? null
    : {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? null,
        expiresAt: response.expires_in === undefined ? null : now + response.expires_in * 1000,
        refreshExpiresAt:
          response.refresh_token_expires_in === undefined
            ? null
            : now + response.refresh_token_expires_in * 1000,
      };

export const newCredentials = ({ store, transport, signedOut }: CredentialsInput) => {
  const cache = new Map<number, TokenPair>();
  const locks = new Map<number, Semaphore.Semaphore>();

  const lockOf = (accountId: number) =>
    Effect.gen(function* () {
      const existing = locks.get(accountId);

      if (existing !== undefined) return existing;

      const made = yield* Semaphore.make(1);

      locks.set(accountId, made);

      return made;
    });

  const authError = (accountId: number, message: string) =>
    Effect.andThen(signedOut(accountId), Effect.fail(new GitHubAuthError({ accountId, message })));

  const current = (accountId: number) =>
    Effect.gen(function* () {
      const cached = cache.get(accountId);

      if (cached !== undefined) return cached;

      const stored = yield* store.readTokens(accountId);

      if (Option.isNone(stored)) return yield* authError(accountId, "no token stored");
      cache.set(accountId, stored.value);

      return stored.value;
    });

  const refresh = (accountId: number, pair: TokenPair) =>
    Effect.gen(function* () {
      if (pair.refreshToken === null) return yield* authError(accountId, "the token expired");

      const response = yield* transport
        .oauth("/login/oauth/access_token", TokenResponse, {
          client_id: GITHUB_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: pair.refreshToken,
        })
        .pipe(Effect.catchTag("GitHubRequestError", () => Effect.succeed<TokenResponse>({})));

      const next = tokenPairFrom(response, yield* Clock.currentTimeMillis);

      if (next === null) {
        return yield* authError(accountId, response.error_description ?? "the refresh failed");
      }

      yield* store.writeTokens(accountId, next);
      cache.set(accountId, next);

      return next;
    });

  const due = (pair: TokenPair, now: number) =>
    pair.expiresAt !== null && pair.expiresAt - now < REFRESH_AHEAD_MS;

  /** A usable access token, refreshed first when it is close to expiring. */
  const token = (accountId: number) =>
    Effect.gen(function* () {
      const pair = yield* current(accountId);

      if (!due(pair, yield* Clock.currentTimeMillis)) return pair.accessToken;

      const lock = yield* lockOf(accountId);

      return yield* lock.withPermit(
        Effect.gen(function* () {
          // Another caller may have refreshed while this one waited.
          const latest = yield* current(accountId);

          if (!due(latest, yield* Clock.currentTimeMillis)) return latest.accessToken;

          return (yield* refresh(accountId, latest)).accessToken;
        })
      );
    });

  /** After a 401 with `stale`: refresh once, unless another caller already did. */
  const renew = (accountId: number, stale: string) =>
    Effect.gen(function* () {
      const lock = yield* lockOf(accountId);

      return yield* lock.withPermit(
        Effect.gen(function* () {
          const latest = yield* current(accountId);

          if (latest.accessToken !== stale) return latest.accessToken;

          return (yield* refresh(accountId, latest)).accessToken;
        })
      );
    });

  const put = (accountId: number, pair: TokenPair) =>
    Effect.tap(store.writeTokens(accountId, pair), () =>
      Effect.sync(() => cache.set(accountId, pair))
    );

  const forget = (accountId: number) =>
    Effect.tap(store.removeTokens(accountId), () => Effect.sync(() => cache.delete(accountId)));

  return { token, renew, put, forget };
};

export type Credentials = ReturnType<typeof newCredentials>;

export type CredentialsError = GitHubAuthError | GitHubStorageError;
