import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import type { Fetcher, Level } from "../../../../lib/log";
import { createEmailHandler } from "./index";
import {
  createAdmission,
  limits,
  memoryStore,
  normalizeRecipient,
  readSharedStore,
  windowMs,
} from "./limiter";

const decodeCommands = Schema.decodeUnknownSync(
  Schema.Array(Schema.Array(Schema.Union([Schema.String, Schema.Number])))
);

/** An Upstash REST server in memory: SET … PX … NX and INCR, with expiry on a shared clock. */
function fakeUpstash(clock: { now: number }) {
  const keys = new Map<string, { value: number; expires: number }>();
  let requests = 0;

  const live = (key: string) => {
    const entry = keys.get(key);

    if (entry && entry.expires > clock.now) return entry;
    keys.delete(key);

    return undefined;
  };

  const run = (command: ReadonlyArray<string | number>) => {
    const [name, key = "", value, , ttl] = command.map(String);

    if (name === "SET") {
      if (live(key)) return { result: null };
      keys.set(key, { value: Number(value), expires: clock.now + Number(ttl) });

      return { result: "OK" };
    }

    const entry = live(key) ?? { value: 0, expires: Number.POSITIVE_INFINITY };
    entry.value += 1;
    keys.set(key, entry);

    return { result: entry.value };
  };

  const fetcher: Fetcher = async (url, init) => {
    requests += 1;
    expect(url).toBe("https://limits.upstash.io/multi-exec");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");

    return Response.json(decodeCommands(JSON.parse(await new Response(init.body).text())).map(run));
  };

  return { fetcher, keys, requests: () => requests };
}

const env = { KV_REST_API_URL: "https://limits.upstash.io", KV_REST_API_TOKEN: "token" };

/** A fresh function instance: its own module state, the same deployment env and store. */
function instance(fetcher: Fetcher, clock: { now: number }) {
  const shared = readSharedStore(env, fetcher);

  if (!shared) throw new Error("shared store not configured");

  return createAdmission({ ...shared, vercel: true, now: () => clock.now });
}

const from = (ip: string) => new Headers({ "x-vercel-forwarded-for": ip });

describe("deployment-wide admission", () => {
  test("instances and cold starts share one total budget", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const first = instance(upstash.fetcher, clock);
    const second = instance(upstash.fetcher, clock);
    const verdicts: string[] = [];

    for (let i = 0; i < limits.total; i++)
      verdicts.push(await (i % 2 ? first : second)(from(`192.0.2.${i}`), `ada${i}@example.com`));

    expect(verdicts.every((verdict) => verdict === "admitted")).toBe(true);
    expect(await first(from("198.51.100.1"), "late@example.com")).toBe("total_limited");

    const coldStart = instance(upstash.fetcher, clock);
    expect(await coldStart(from("198.51.100.2"), "later@example.com")).toBe("total_limited");

    clock.now = windowMs;
    expect(await coldStart(from("198.51.100.2"), "later@example.com")).toBe("admitted");
  });

  test("a source is limited across instances", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const first = instance(upstash.fetcher, clock);
    const second = instance(upstash.fetcher, clock);

    for (let i = 0; i < limits.perSource; i++)
      expect(await (i % 2 ? first : second)(from("192.0.2.1"), `ada${i}@example.com`)).toBe(
        "admitted"
      );

    expect(await second(from("192.0.2.1"), "bob@example.com")).toBe("source_limited");
  });

  test("rotating sources and spellings cannot mail one recipient twice in the cooldown", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const first = instance(upstash.fetcher, clock);
    const second = instance(upstash.fetcher, clock);

    expect(await first(from("192.0.2.1"), "Ada.Lovelace@gmail.com")).toBe("admitted");
    expect(await second(from("192.0.2.2"), "adalovelace+mac@googlemail.com")).toBe(
      "recipient_cooldown"
    );

    clock.now = limits.recipientCooldownMs;
    expect(await second(from("192.0.2.3"), "ada.lovelace@gmail.com")).toBe("admitted");
  });

  test("the store holds digests, never an address or IP", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    await instance(upstash.fetcher, clock)(from("192.0.2.77"), "private-recipient@example.com");

    const stored = [...upstash.keys.keys()].join(" ");
    expect(stored).not.toContain("private-recipient");
    expect(stored).not.toContain("192.0.2.77");
  });

  test("an unreachable store fails closed before validation or sending", async () => {
    const store = readSharedStore(env, async () => new Response("down", { status: 503 }))?.store;

    if (!store) throw new Error("shared store not configured");
    const calls: string[] = [];
    const tasks: Array<() => Promise<Level | void>> = [];

    const handler = createEmailHandler({
      checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
      admit: createAdmission({ store, vercel: true }),
      preview: false,
      validator: {
        validate: async () => {
          calls.push("validator");

          return true;
        },
      },
      transport: () => ({
        preview: false,
        send: async () => {
          calls.push("SES");
        },
      }),
    });

    const event = {};

    const response = await handler(
      new Request("https://polaris.lux.dev/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", website: "" }),
      }),
      event,
      (task) => tasks.push(task)
    );

    expect(await Promise.all(tasks.map((task) => task()))).toEqual(["error"]);
    expect(response.status).toBe(202);
    expect(event).toMatchObject({ failure: "limiter_unavailable" });
    expect(calls).toEqual([]);
  });

  test.each([
    {},
    { KV_REST_API_URL: "http://limits.upstash.io", KV_REST_API_TOKEN: "token" },
    { KV_REST_API_URL: "https://limits.upstash.io" },
  ])("no usable shared store config falls back %#", (partial) => {
    expect(readSharedStore(partial)).toBeNull();
  });
});

describe("process-local fallback", () => {
  test("a full store limits instead of evicting live entries", async () => {
    const store = memoryStore(() => 0, 2);
    expect(await store.claim("a", 10)).toBe(true);
    expect(await store.increment("b", 10)).toBe(1);
    expect(await store.claim("c", 10)).toBe(false);
    expect(await store.increment("d", 10)).toBeGreaterThan(limits.total);
  });

  test("expired entries make room again", async () => {
    let now = 0;
    const store = memoryStore(() => now, 1);
    expect(await store.claim("a", 10)).toBe(true);
    now = 10;
    expect(await store.claim("b", 10)).toBe(true);
    expect(await store.claim("b", 10)).toBe(false);
  });

  test("missing or untrusted forwarded-for headers share one source bucket", async () => {
    const admit = createAdmission({ store: memoryStore(() => 0), vercel: false, now: () => 0 });

    for (let i = 0; i < limits.perSource; i++)
      expect(await admit(from(`192.0.2.${i}`), `ada${i}@example.com`)).toBe("admitted");
    expect(await admit(new Headers(), "bob@example.com")).toBe("source_limited");
  });

  test("IPv6 spellings share a source bucket", async () => {
    const admit = createAdmission({ store: memoryStore(() => 0), vercel: true, now: () => 0 });

    for (let i = 0; i < limits.perSource; i++)
      expect(await admit(from("2001:db8::1"), `ada${i}@example.com`)).toBe("admitted");
    expect(await admit(from("2001:0db8:0:0:0:0:0:1"), "bob@example.com")).toBe("source_limited");
  });
});

test.each([
  ["Ada@Example.com", "ada@example.com"],
  ["ada+mac@example.com", "ada@example.com"],
  ["a.d.a@gmail.com", "ada@gmail.com"],
  ["a.da@googlemail.com", "ada@gmail.com"],
  ["a.da@example.com", "a.da@example.com"],
])("recipient %s is the mailbox %s", (email, mailbox) => {
  expect(normalizeRecipient(email)).toBe(mailbox);
});
