import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { Schema } from "effect";
import type { Fetcher } from "../../../../lib/log";

export const windowMs = 15 * 60 * 1000;

/** Sizes and their reasons are in this route's README ("Admission limits"). */
export const limits = {
  perSource: 3,
  unknownSource: 30,
  total: 450,
  recipientCooldownMs: 10 * 60 * 1000,
} as const;

/** Counters and claims the limiter keeps; keys are prefixed digests, never addresses or IPs. */
export interface LimitStore {
  /** Atomically adds one to `key` (expiring `ttlMs` after it was created) and returns the count. */
  increment(key: string, ttlMs: number): Promise<number>;
  /** Sets `key` for `ttlMs` only if it is absent; true when this call set it. */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Removes `key`, so a claim that sent nothing doesn't hold its cooldown. */
  release(key: string): Promise<void>;
}

export type Admission = "admitted" | "source_limited" | "total_limited" | "recipient_cooldown";

/** Process-local fallback: bounded, evicting expired and then least recently used entries. */
export function memoryStore(now: () => number = Date.now, capacity = 10_000): LimitStore {
  const entries = new Map<string, { count: number; expires: number }>();

  const live = (key: string) => {
    const entry = entries.get(key);
    entries.delete(key);

    if (!entry || entry.expires <= now()) return undefined;
    entries.set(key, entry);

    return entry;
  };

  const insert = (key: string, ttlMs: number) => {
    if (entries.size >= capacity)
      for (const [stale, entry] of entries) if (entry.expires <= now()) entries.delete(stale);

    for (const oldest of entries.keys()) {
      if (entries.size < capacity) break;
      entries.delete(oldest);
    }

    entries.set(key, { count: 1, expires: now() + ttlMs });
  };

  return {
    increment: async (key, ttlMs) => {
      const entry = live(key);

      if (entry) return ++entry.count;
      insert(key, ttlMs);

      return 1;
    },
    claim: async (key, ttlMs) => {
      if (live(key)) return false;
      insert(key, ttlMs);

      return true;
    },
    release: async (key) => {
      entries.delete(key);
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

      return decodeIncrement(reply)[1].result;
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

/** IPv6 hosts are keyed by their /64, the block one subscriber usually holds. */
function ipv6Source(raw: string) {
  const hostname = new URL(`http://[${raw}]`).hostname.slice(1, -1);
  const [head = "", tail] = hostname.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back];

  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    const [high = 0, low = 0] = groups.slice(6).map((group) => Number.parseInt(group, 16));

    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }

  return `${groups.slice(0, 4).join(":")}::/64`;
}

function canonicalSource(value: string | null) {
  const raw = value?.split(",").at(-1)?.trim() ?? "";
  const version = isIP(raw);

  if (version === 4) return raw;

  return version === 6 ? ipv6Source(raw) : undefined;
}

/** Headers Vercel's edge sets itself, most specific first; elsewhere none can be trusted. */
const platformHeaders = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] as const;

export function sourceIdentity(headers: Headers, vercel: boolean): string | undefined {
  if (!vercel) return undefined;

  for (const name of platformHeaders) {
    const source = canonicalSource(headers.get(name));

    if (source) return source;
  }

  return undefined;
}

type Options = {
  store: LimitStore;
  secret?: Uint8Array | undefined;
  vercel: boolean;
  now?: () => number;
};

/**
 * Admits a submission only within its source's window, the deployment-wide ceiling and
 * the recipient's cooldown, checked in that order so a refused one spends no later budget.
 * `release` lifts the cooldown again for a submission that sent nothing.
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
    const identity = sourceIdentity(headers, vercel);
    const source = identity ? digest(identity) : "unknown";
    const budget = identity ? limits.perSource : limits.unknownSource;

    if ((await store.increment(`polaris:email:source:${window}:${source}`, windowMs)) > budget)
      return "source_limited";

    if ((await store.increment(`polaris:email:total:${window}`, windowMs)) > limits.total)
      return "total_limited";

    return (await store.claim(recipientKey(email), limits.recipientCooldownMs))
      ? "admitted"
      : "recipient_cooldown";
  };

  return { admit, release: (email: string) => store.release(recipientKey(email)) };
}
