import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { Schema } from "effect";
import type { Fetcher } from "../../../../lib/log";

export const windowMs = 15 * 60 * 1000;

export const limits = {
  perSource: 3,
  total: 100,
  recipientCooldownMs: 24 * 60 * 60 * 1000,
} as const;

/** Counters and claims the limiter keeps; keys are prefixed digests, never addresses or IPs. */
export interface LimitStore {
  /** Atomically adds one to `key` (expiring `ttlMs` after it was created) and returns the count. */
  increment(key: string, ttlMs: number): Promise<number>;
  /** Sets `key` for `ttlMs` only if it is absent; true when this call set it. */
  claim(key: string, ttlMs: number): Promise<boolean>;
}

export type Admission = "admitted" | "source_limited" | "total_limited" | "recipient_cooldown";

/** Process-local fallback: bounded, and full means limited rather than evicting live entries. */
export function memoryStore(now: () => number = Date.now, capacity = 10_000): LimitStore {
  const entries = new Map<string, { count: number; expires: number }>();

  const live = (key: string) => {
    const entry = entries.get(key);

    if (entry && entry.expires > now()) return entry;
    entries.delete(key);

    return undefined;
  };

  const room = () => {
    if (entries.size < capacity) return true;

    for (const [key, entry] of entries) if (entry.expires <= now()) entries.delete(key);

    return entries.size < capacity;
  };

  return {
    increment: async (key, ttlMs) => {
      const entry = live(key);

      if (entry) return ++entry.count;

      if (!room()) return Number.POSITIVE_INFINITY;
      entries.set(key, { count: 1, expires: now() + ttlMs });

      return 1;
    },
    claim: async (key, ttlMs) => {
      if (live(key) || !room()) return false;
      entries.set(key, { count: 1, expires: now() + ttlMs });

      return true;
    },
  };
}

const SetResult = Schema.Struct({ result: Schema.Union([Schema.Literal("OK"), Schema.Null]) });

const decodeIncrement = Schema.decodeSync(
  Schema.fromJsonString(Schema.Tuple([SetResult, Schema.Struct({ result: Schema.Number })]))
);

const decodeClaim = Schema.decodeSync(Schema.fromJsonString(Schema.Tuple([SetResult])));

/** Upstash Redis over its REST transaction endpoint; any error or odd reply throws. */
export function upstashStore(url: string, token: string, fetcher: Fetcher = fetch): LimitStore {
  const transact = async (commands: ReadonlyArray<ReadonlyArray<string | number>>) => {
    const response = await fetcher(`${url.replace(/\/+$/, "")}/multi-exec`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) throw new Error(`Limit store answered ${response.status}`);

    return response.text();
  };

  return {
    increment: async (key, ttlMs) => {
      const reply = await transact([
        ["SET", key, "0", "PX", ttlMs, "NX"],
        ["INCR", key],
      ]);

      return decodeIncrement(reply)[1].result;
    },
    claim: async (key, ttlMs) =>
      decodeClaim(await transact([["SET", key, "1", "PX", ttlMs, "NX"]]))[0].result === "OK",
  };
}

export type LimitEnv = Readonly<Record<string, string | undefined>>;

/** The shared store when its REST URL and token are set (Vercel's Upstash integration names). */
export function readSharedStore(env: LimitEnv, fetcher: Fetcher = fetch) {
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();

  if (!url?.startsWith("https://") || !token) return null;

  return {
    store: upstashStore(url, token, fetcher),
    secret: createHash("sha256").update(`polaris-email-limit:${token}`).digest(),
  };
}

/** One mailbox per key: case, `+tags` and Gmail's ignored dots don't make a new recipient. */
export function normalizeRecipient(email: string): string {
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1).toLowerCase();
  let local = email.slice(0, at).toLowerCase().split("+")[0] ?? "";

  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replaceAll(".", "");

  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

function sourceIdentity(headers: Headers, vercel: boolean) {
  const raw = vercel ? headers.get("x-vercel-forwarded-for")?.trim() : undefined;
  const version = raw ? isIP(raw) : 0;

  if (raw && version === 4) return raw;

  if (raw && version === 6) return new URL(`http://[${raw}]`).hostname;

  return "unknown";
}

type Options = {
  store: LimitStore;
  secret?: Uint8Array;
  vercel: boolean;
  now?: () => number;
};

/**
 * Admits a submission only within its source's window, the deployment-wide window and
 * the recipient's cooldown, checked in that order so a refused one spends no later budget.
 */
export function createAdmission({
  store,
  secret = randomBytes(32),
  vercel,
  now = Date.now,
}: Options) {
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");

  return async (headers: Headers, email: string): Promise<Admission> => {
    const window = Math.floor(now() / windowMs);
    const source = digest(sourceIdentity(headers, vercel));

    if (
      (await store.increment(`polaris:email:source:${window}:${source}`, windowMs)) >
      limits.perSource
    )
      return "source_limited";

    if ((await store.increment(`polaris:email:total:${window}`, windowMs)) > limits.total)
      return "total_limited";

    const recipient = `polaris:email:recipient:${digest(normalizeRecipient(email))}`;

    return (await store.claim(recipient, limits.recipientCooldownMs))
      ? "admitted"
      : "recipient_cooldown";
  };
}
