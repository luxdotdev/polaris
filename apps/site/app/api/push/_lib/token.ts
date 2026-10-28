/**
 * APNs provider tokens signed by Vercel KMS (`signJWT`, ttl 3600; ADR 0080). One token per
 * issuer is shared by every instance through the store and replaced after 55 minutes: APNs
 * rejects tokens older than an hour and answers TooManyProviderTokenUpdates to frequent ones.
 */
import { Option, Schema } from "effect";
import type { Issuer } from "./environment";
import type { PushStore } from "./store";

/** How long a token is used before a fresh one is signed. */
export const TOKEN_MAX_AGE_MS = 55 * 60 * 1000;

const LOCK_MS = 10_000;

const WAIT_STEP_MS = 100;

const WAIT_MS = 3_000;

export type SignToken = (issuer: Issuer) => Promise<string>;

const Cached = Schema.Struct({ token: Schema.String, issuedAt: Schema.Number });

type Cached = typeof Cached.Type;

const decodeCached = Schema.decodeUnknownOption(Schema.fromJsonString(Cached));

const tokenKey = (issuer: Issuer) => `polaris:push:token:${issuer.issuerId}`;

const lockKey = (issuer: Issuer) => `polaris:push:token-lock:${issuer.issuerId}`;

export interface ProviderToken {
  readonly token: string;
  /** Where it came from, for the wide event: this instance, the store, or KMS just now. */
  readonly source: "memory" | "store" | "signed";
}

export interface ProviderTokens {
  readonly get: (issuer: Issuer) => Promise<ProviderToken>;
  /** APNs refused `token` as expired or invalid: forget it unless a newer one replaced it. */
  readonly invalidate: (issuer: Issuer, token: string) => Promise<void>;
}

export const providerTokens = (options: {
  readonly store: PushStore;
  readonly sign: SignToken;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): ProviderTokens => {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const memo = new Map<string, Cached>();

  const fresh = (cached: Cached | null | undefined) =>
    cached != null && now() - cached.issuedAt < TOKEN_MAX_AGE_MS ? cached : null;

  const stored = async (issuer: Issuer) =>
    fresh(Option.getOrNull(decodeCached(await options.store.get(tokenKey(issuer)))));

  const signNew = async (issuer: Issuer): Promise<Cached> => {
    const cached = { token: await options.sign(issuer), issuedAt: now() };
    const left = TOKEN_MAX_AGE_MS - (now() - cached.issuedAt);
    await options.store.put(tokenKey(issuer), JSON.stringify(cached), Math.max(1, left));

    return cached;
  };

  /** One instance signs; the others wait briefly for its token rather than sign their own. */
  const fromStoreOrSign = async (issuer: Issuer): Promise<ProviderToken> => {
    const found = await stored(issuer);

    if (found !== null) return { ...remember(issuer, found), source: "store" };

    if (await options.store.claim(lockKey(issuer), LOCK_MS)) {
      try {
        return { ...remember(issuer, await signNew(issuer)), source: "signed" };
      } finally {
        await options.store.drop(lockKey(issuer));
      }
    }

    for (let waited = 0; waited < WAIT_MS; waited += WAIT_STEP_MS) {
      await sleep(WAIT_STEP_MS);
      const signed = await stored(issuer);

      if (signed !== null) return { ...remember(issuer, signed), source: "store" };
    }

    return { ...remember(issuer, await signNew(issuer)), source: "signed" };
  };

  const remember = (issuer: Issuer, cached: Cached) => {
    memo.set(issuer.issuerId, cached);

    return { token: cached.token };
  };

  return {
    get: async (issuer) => {
      const local = fresh(memo.get(issuer.issuerId));

      return local === null ? fromStoreOrSign(issuer) : { token: local.token, source: "memory" };
    },
    invalidate: async (issuer, token) => {
      if (memo.get(issuer.issuerId)?.token === token) memo.delete(issuer.issuerId);
      const current = Option.getOrNull(decodeCached(await options.store.get(tokenKey(issuer))));

      if (current?.token === token) await options.store.drop(tokenKey(issuer));
    },
  };
};
