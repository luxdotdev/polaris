import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { Schema } from "effect";
import type { Fetcher } from "../../../../lib/log";

export const windowMs = 15 * 60 * 1000;

/** Sizes and their reasons are in this route's README ("Admission limits"). */
export const limits = {
  perSource: 3,
  perNetwork: 30,
  unknownSource: 30,
  overflowSource: 10,
  total: 450,
  recipientCooldownMs: 10 * 60 * 1000,
} as const;

/** A counter's value after an increment; `overflowed` when it was counted in the overflow key. */
export type Count = { count: number; overflowed: boolean };

/** Counters and claims the limiter keeps; keys are prefixed digests, never addresses or IPs. */
export interface LimitStore {
  /**
   * Atomically adds one to `key` (expiring `ttlMs` after it was created) and returns the count.
   * A store with no room for a new `key` counts `overflow` instead; without one it always makes room.
   */
  increment(key: string, ttlMs: number, overflow?: string): Promise<Count>;
  /** Sets `key` for `ttlMs` only if it is absent; true when this call set it, false when full. */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Removes `key`, so a claim that sent nothing doesn't hold its cooldown. */
  release(key: string): Promise<void>;
}

export type Admission = "admitted" | "source_limited" | "total_limited" | "recipient_cooldown";

type Entry = { count: number; expires: number };

/** Drops expired entries from the front; the limiter gives each map one TTL, so that is expiry order. */
function purge(entries: Map<string, Entry>, now: number) {
  for (const [key, entry] of entries) {
    if (entry.expires > now) return;
    entries.delete(key);
  }
}

/**
 * Process-local fallback. It never evicts a live entry: once `capacity` keys that name an
 * overflow are live, new ones count the overflow, and once `capacity` claims are live, claims fail.
 */
export function memoryStore(now: () => number = Date.now, capacity = 10_000): LimitStore {
  const bounded = new Map<string, Entry>();
  const unbounded = new Map<string, Entry>();
  const claims = new Map<string, Entry>();

  const live = (entries: Map<string, Entry>, key: string) => {
    const entry = entries.get(key);

    if (entry && entry.expires > now()) return entry;
    entries.delete(key);

    return undefined;
  };

  const add = (entries: Map<string, Entry>, key: string, ttlMs: number, overflowed: boolean) => {
    const entry = live(entries, key);

    if (entry) return { count: ++entry.count, overflowed };
    purge(entries, now());
    entries.set(key, { count: 1, expires: now() + ttlMs });

    return { count: 1, overflowed };
  };

  const full = (entries: Map<string, Entry>) => {
    if (entries.size >= capacity) purge(entries, now());

    return entries.size >= capacity;
  };

  return {
    increment: async (key, ttlMs, overflow) => {
      if (overflow === undefined) return add(unbounded, key, ttlMs, false);

      if (live(bounded, key) || !full(bounded)) return add(bounded, key, ttlMs, false);

      return add(unbounded, overflow, ttlMs, true);
    },
    claim: async (key, ttlMs) => {
      if (live(claims, key) || full(claims)) return false;
      claims.set(key, { count: 1, expires: now() + ttlMs });

      return true;
    },
    release: async (key) => {
      claims.delete(key);
    },
  };
}

const SetResult = Schema.Struct({ result: Schema.Union([Schema.Literal("OK"), Schema.Null]) });

const decodeIncrement = Schema.decodeSync(
  Schema.fromJsonString(Schema.Tuple([SetResult, Schema.Struct({ result: Schema.Number })]))
);

const decodeClaim = Schema.decodeSync(Schema.fromJsonString(Schema.Tuple([SetResult])));

const decodeRelease = Schema.decodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.Struct({ result: Schema.Number })]))
);

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

      return { count: decodeIncrement(reply)[1].result, overflowed: false };
    },
    claim: async (key, ttlMs) =>
      decodeClaim(await transact([["SET", key, "1", "PX", ttlMs, "NX"]]))[0].result === "OK",
    release: async (key) => {
      decodeRelease(await transact([["DEL", key]]));
    },
  };
}

export type LimitEnv = Readonly<Record<string, string | undefined>>;

const keyFrom = (label: string, value: string) =>
  createHash("sha256").update(`${label}:${value}`).digest();

/** The digest key from `POLARIS_EMAIL_LIMIT_SECRET`, when set. */
export function readLimitSecret(env: LimitEnv) {
  const secret = env.POLARIS_EMAIL_LIMIT_SECRET?.trim();

  return secret ? keyFrom("polaris-email-limit-secret", secret) : undefined;
}

/** The shared store when its REST URL and token are set (Vercel's Upstash integration names). */
export function readSharedStore(env: LimitEnv, fetcher: Fetcher = fetch) {
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();

  if (!url?.startsWith("https://") || !token) return null;

  return {
    store: upstashStore(url, token, fetcher),
    secret: readLimitSecret(env) ?? keyFrom("polaris-email-limit", token),
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

/** A source's own key and the wider network it belongs to; both budgets must pass. */
export type Source = { host: string; network: string };

/** IPv6 hosts are keyed by their /64, the block one subscriber usually holds, inside its /48. */
function ipv6Source(raw: string): Source {
  const hostname = new URL(`http://[${raw}]`).hostname.slice(1, -1);
  const [head = "", tail] = hostname.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back];

  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    const [high = 0, low = 0] = groups.slice(6).map((group) => Number.parseInt(group, 16));

    return ipv4Source([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }

  return {
    host: `${groups.slice(0, 4).join(":")}::/64`,
    network: `${groups.slice(0, 3).join(":")}::/48`,
  };
}

function ipv4Source(raw: string): Source {
  return { host: raw, network: `${raw.split(".").slice(0, 3).join(".")}.0/24` };
}

function canonicalSource(value: string | null) {
  const raw = value?.split(",").at(-1)?.trim() ?? "";
  const version = isIP(raw);

  if (version === 4) return ipv4Source(raw);

  return version === 6 ? ipv6Source(raw) : undefined;
}

/** Only Vercel's own header names the source; anything else a client could have written. */
export function sourceIdentity(headers: Headers, vercel: boolean): Source | undefined {
  return vercel ? canonicalSource(headers.get("x-vercel-forwarded-for")) : undefined;
}

type Counter = { key: string; overflow?: string; budget: number };

/** Coarsest first, so a request its network refuses never creates a per-host counter. */
function sourceCounters(
  sources: string,
  identity: Source | undefined,
  digest: (value: string) => string
): Counter[] {
  if (!identity) return [{ key: `${sources}:unknown`, budget: limits.unknownSource }];

  return [
    {
      key: `${sources}:network:${digest(identity.network)}`,
      overflow: `${sources}:network-overflow`,
      budget: limits.perNetwork,
    },
    {
      key: `${sources}:${digest(identity.host)}`,
      overflow: `${sources}:overflow`,
      budget: limits.perSource,
    },
  ];
}

type Options = {
  store: LimitStore;
  secret?: Uint8Array | undefined;
  vercel: boolean;
  now?: () => number;
};

/**
 * Admits a submission only within its source's network and host windows, the deployment-wide
 * ceiling and the recipient's cooldown, checked in that order so a refused one spends no later budget.
 * `release` lifts the cooldown again, only for a submission that our side failed to send.
 */
export function createAdmission({
  store,
  secret = randomBytes(32),
  vercel,
  now = Date.now,
}: Options) {
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");

  const recipientKey = (email: string) =>
    `polaris:email:recipient:${digest(normalizeRecipient(email))}`;

  const admit = async (headers: Headers, email: string): Promise<Admission> => {
    const window = Math.floor(now() / windowMs);
    const sources = `polaris:email:source:${window}`;

    for (const counter of sourceCounters(sources, sourceIdentity(headers, vercel), digest)) {
      const { count, overflowed } = await store.increment(counter.key, windowMs, counter.overflow);

      if (count > (overflowed ? limits.overflowSource : counter.budget)) return "source_limited";
    }

    if ((await store.increment(`polaris:email:total:${window}`, windowMs)).count > limits.total)
      return "total_limited";

    return (await store.claim(recipientKey(email), limits.recipientCooldownMs))
      ? "admitted"
      : "recipient_cooldown";
  };

  return { admit, release: (email: string) => store.release(recipientKey(email)) };
}
