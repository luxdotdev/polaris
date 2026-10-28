/**
 * What the push route shares across instances: seen request nonces and the provider token
 * per issuer. Upstash Redis when configured (the same store as `/api/email`), else memory.
 * Keys are `polaris:push:…`; nothing here is ever logged.
 */
import { Predicate, Schema } from "effect";

export interface PushStore {
  readonly kind: "shared" | "local";
  /** Sets `key` for `ttlMs` only if absent; true when this call set it. */
  readonly claim: (key: string, ttlMs: number) => Promise<boolean>;
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string, ttlMs: number) => Promise<void>;
  readonly drop: (key: string) => Promise<void>;
}

export const memoryStore = (now: () => number = Date.now, capacity = 10_000): PushStore => {
  const entries = new Map<string, { value: string; expires: number }>();

  const live = (key: string) => {
    const entry = entries.get(key);

    if (entry === undefined) return null;

    if (entry.expires > now()) return entry;
    entries.delete(key);

    return null;
  };

  const set = (key: string, value: string, ttlMs: number) => {
    if (entries.size >= capacity) {
      for (const [k, e] of entries) if (e.expires <= now()) entries.delete(k);
    }

    // When still full, the oldest entry goes: a nonce older than the window is harmless.
    if (entries.size >= capacity) entries.delete(entries.keys().next().value ?? "");
    entries.set(key, { value, expires: now() + ttlMs });
  };

  return {
    kind: "local",
    claim: async (key, ttlMs) => {
      if (live(key) !== null) return false;
      set(key, "1", ttlMs);

      return true;
    },
    get: async (key) => live(key)?.value ?? null,
    put: async (key, value, ttlMs) => set(key, value, ttlMs),
    drop: async (key) => void entries.delete(key),
  };
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const Results = Schema.Array(
  Schema.Struct({ result: Schema.Union([Schema.String, Schema.Number, Schema.Null]) })
);

const decodeResults = Schema.decodeUnknownSync(Schema.fromJsonString(Results));

/** Upstash Redis over REST; any error or odd reply throws. */
export const upstashStore = (url: string, token: string, fetcher: Fetcher = fetch): PushStore => {
  const run = async (command: ReadonlyArray<string | number>) => {
    const response = await fetcher(`${url.replace(/\/+$/, "")}/multi-exec`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([command]),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) throw new Error(`Push store answered ${response.status}`);
    const [first] = decodeResults(await response.text());

    return first?.result ?? null;
  };

  return {
    kind: "shared",
    claim: async (key, ttlMs) => (await run(["SET", key, "1", "PX", ttlMs, "NX"])) === "OK",
    get: async (key) => {
      const value = await run(["GET", key]);

      return Predicate.isString(value) ? value : null;
    },
    put: async (key, value, ttlMs) => void (await run(["SET", key, value, "PX", ttlMs])),
    drop: async (key) => void (await run(["DEL", key])),
  };
};

export type PushEnv = Readonly<Record<string, string | undefined>>;

/** The shared store from `KV_REST_API_*` (or `UPSTASH_REDIS_REST_*`), else null. */
export const readSharedStore = (env: PushEnv, fetcher: Fetcher = fetch): PushStore | null => {
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();

  return url?.startsWith("https://") && token ? upstashStore(url, token, fetcher) : null;
};
