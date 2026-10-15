import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import type { Fetcher, Level, WideEvent } from "../../../../lib/log";
import { createEmailHandler } from "./index";
import type { EmailTransport } from "./transport";
import type { EmailValidator } from "./validator";
import {
  createAdmission,
  limits,
  memoryStore,
  normalizeRecipient,
  readSharedStore,
  windowMs,
  type LimitEnv,
} from "./limiter";

const decodeCommands = Schema.decodeUnknownSync(
  Schema.Array(Schema.Array(Schema.Union([Schema.String, Schema.Number])))
);

/** An Upstash REST server in memory: SET … PX … NX, INCR and DEL, with expiry on a shared clock. */
function fakeUpstash(clock: { now: number }) {
  const keys = new Map<string, { value: number; expires: number }>();

  const live = (key: string) => {
    const entry = keys.get(key);

    if (entry && entry.expires > clock.now) return entry;
    keys.delete(key);

    return undefined;
  };

  const run = (command: ReadonlyArray<string | number>) => {
    const [name, key = "", value, , ttl] = command.map(String);

    if (name === "DEL") return { result: keys.delete(key) ? 1 : 0 };

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
    expect(url).toBe("https://limits.upstash.io/multi-exec");

    return Response.json(decodeCommands(JSON.parse(await new Response(init.body).text())).map(run));
  };

  return { fetcher, keys };
}

const env = { KV_REST_API_URL: "https://limits.upstash.io", KV_REST_API_TOKEN: "token" };

/** A fresh function instance: its own module state, the same deployment env and store. */
function instance(fetcher: Fetcher, clock: { now: number }, deployment: LimitEnv = env) {
  const shared = readSharedStore(deployment, fetcher);

  if (!shared) throw new Error("shared store not configured");

  return createAdmission({ ...shared, vercel: true, now: () => clock.now }).admit;
}

const from = (ip: string) => new Headers({ "x-vercel-forwarded-for": ip });

const minutes = (count: number) => count * 60 * 1000;

describe("deployment-wide admission", () => {
  test("instances and cold starts share one total ceiling", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const first = instance(upstash.fetcher, clock);
    const second = instance(upstash.fetcher, clock);
    const verdicts: string[] = [];

    for (let i = 0; i < limits.total; i++)
      verdicts.push(
        await (i % 2 ? first : second)(from(`10.0.${i >> 8}.${i & 255}`), `ada${i}@example.com`)
      );

    expect(verdicts.every((verdict) => verdict === "admitted")).toBe(true);
    expect(await first(from("198.51.100.1"), "late@example.com")).toBe("total_limited");

    const coldStart = instance(upstash.fetcher, clock);
    expect(await coldStart(from("198.51.100.2"), "later@example.com")).toBe("total_limited");

    clock.now = windowMs;
    expect(await coldStart(from("198.51.100.2"), "later@example.com")).toBe("admitted");
  });

  test("a few dozen sources at their own limit don't lock out the next visitor", async () => {
    const clock = { now: 0 };
    const admit = instance(fakeUpstash(clock).fetcher, clock);

    for (let source = 0; source < 34; source++)
      for (let i = 0; i < 4; i++)
        await admit(from(`192.0.2.${source}`), `s${source}n${i}@example.com`);

    expect(await admit(from("198.51.100.1"), "visitor@example.com")).toBe("admitted");
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

  test("rotating sources and spellings cannot mail one recipient twice in ten minutes", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const first = instance(upstash.fetcher, clock);
    const second = instance(upstash.fetcher, clock);

    expect(await first(from("192.0.2.1"), "Ada.Lovelace@gmail.com")).toBe("admitted");
    expect(await second(from("192.0.2.2"), "adalovelace+mac@googlemail.com")).toBe(
      "recipient_cooldown"
    );

    clock.now = minutes(10);
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

  test("with POLARIS_EMAIL_LIMIT_SECRET set, rotating the store token keeps cooldowns", async () => {
    const clock = { now: 0 };
    const upstash = fakeUpstash(clock);
    const secret = { POLARIS_EMAIL_LIMIT_SECRET: "a-dedicated-secret" };
    const before = instance(upstash.fetcher, clock, { ...env, ...secret });
    const after = instance(upstash.fetcher, clock, { ...env, ...secret, KV_REST_API_TOKEN: "new" });

    expect(await before(from("192.0.2.1"), "ada@example.com")).toBe("admitted");
    expect(await after(from("192.0.2.2"), "ada@example.com")).toBe("recipient_cooldown");
  });

  test.each([
    {},
    { KV_REST_API_URL: "http://limits.upstash.io", KV_REST_API_TOKEN: "token" },
    { KV_REST_API_URL: "https://limits.upstash.io" },
  ])("no usable shared store config falls back %#", (partial) => {
    expect(readSharedStore(partial)).toBeNull();
  });
});

const submission = (email: string) =>
  new Request("https://polaris.lux.dev/api/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": "192.0.2.1" },
    body: JSON.stringify({ email, website: "" }),
  });

/** The handler over a real admission and store, with a validator and SES that can fail. */
function handlerWith(
  store = memoryStore(() => 0),
  validator: EmailValidator,
  sender: EmailTransport
) {
  const handler = createEmailHandler({
    checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
    ...createAdmission({ store, vercel: true, now: () => 0 }),
    preview: false,
    validator,
    transport: () => sender,
  });

  return async (email: string) => {
    const tasks: Array<() => Promise<Level | void>> = [];
    const event: WideEvent = {};
    const response = await handler(submission(email), event, (task) => tasks.push(task));
    const levels = await Promise.all(tasks.map((task) => task()));

    return { status: response.status, event, levels };
  };
}

describe("recipient cooldown", () => {
  const failing = (failures: { validation?: number; send?: number }) => {
    const sent: string[] = [];
    let validations = 0;
    let sends = 0;

    const validator: EmailValidator = {
      validate: async () => {
        validations += 1;

        if (validations <= (failures.validation ?? 0)) throw new Error("throttled");

        return true;
      },
    };

    const sender: EmailTransport = {
      preview: false,
      send: async (email) => {
        sends += 1;

        if (sends <= (failures.send ?? 0)) throw new Error("SES down");
        sent.push(email);
      },
    };

    return { validator, sender, sent };
  };

  test.each([
    ["a failed send", { send: 1 }],
    ["an unavailable validation", { validation: 1 }],
  ])("%s doesn't hold the address's cooldown", async (_, failures) => {
    const f = failing(failures);

    const submit = handlerWith(
      memoryStore(() => 0),
      f.validator,
      f.sender
    );

    expect((await submit("ada@example.com")).levels).toEqual(["error"]);
    expect((await submit("ada@example.com")).event).toMatchObject({ delivery: "sent" });
    expect(f.sent).toEqual(["ada@example.com"]);
  });

  test("a sent email holds the cooldown", async () => {
    const f = failing({});

    const submit = handlerWith(
      memoryStore(() => 0),
      f.validator,
      f.sender
    );

    await submit("ada@example.com");
    expect((await submit("ada@example.com")).event).toMatchObject({
      rejection: "recipient_cooldown",
    });
    expect(f.sent).toEqual(["ada@example.com"]);
  });

  test("an unreachable store fails closed before validation or sending", async () => {
    const store = readSharedStore(env, async () => new Response("down", { status: 503 }))?.store;

    if (!store) throw new Error("shared store not configured");
    const f = failing({});
    const result = await handlerWith(store, f.validator, f.sender)("ada@example.com");

    expect(result.levels).toEqual(["error"]);
    expect(result.status).toBe(202);
    expect(result.event).toMatchObject({ failure: "limiter_unavailable" });
    expect(f.sent).toEqual([]);
  });
});

describe("sources", () => {
  const local = (vercel: boolean) =>
    createAdmission({ store: memoryStore(() => 0), vercel, now: () => 0 }).admit;

  test("unidentified submissions share a bucket larger than one source's", async () => {
    const admit = local(false);
    const verdicts = [];

    for (let i = 0; i < limits.unknownSource + 1; i++)
      verdicts.push(await admit(from(`192.0.2.${i}`), `ada${i}@example.com`));

    expect(verdicts.slice(0, 10).every((verdict) => verdict === "admitted")).toBe(true);
    expect(verdicts.at(-1)).toBe("source_limited");
  });

  test("an identified source keeps its own budget beside the unidentified bucket", async () => {
    const admit = local(true);

    for (let i = 0; i < 3; i++)
      expect(await admit(new Headers(), `u${i}@example.com`)).toBe("admitted");

    for (let i = 0; i < 3; i++)
      expect(await admit(from("192.0.2.1"), `ada${i}@example.com`)).toBe("admitted");
    expect(await admit(from("192.0.2.1"), "bob@example.com")).toBe("source_limited");
  });

  test("without Vercel's header, the platform's rightmost forwarded hop is the source", async () => {
    const admit = local(true);
    const via = (forwarded: string) => new Headers({ "x-forwarded-for": forwarded });

    for (let i = 0; i < 3; i++) {
      expect(await admit(via(`203.0.113.${i}, 192.0.2.1`), `a${i}@example.com`)).toBe("admitted");
      expect(await admit(new Headers({ "x-real-ip": "192.0.2.2" }), `b${i}@example.com`)).toBe(
        "admitted"
      );
    }

    expect(await admit(via("203.0.113.99, 192.0.2.1"), "c@example.com")).toBe("source_limited");
  });

  test("IPv6 spellings and hosts in one /64 share a source bucket", async () => {
    const admit = local(true);

    expect(await admit(from("2001:db8::1"), "a@example.com")).toBe("admitted");
    expect(await admit(from("2001:0db8:0:0:0:0:0:2"), "b@example.com")).toBe("admitted");
    expect(await admit(from("2001:db8::ffff:3"), "c@example.com")).toBe("admitted");
    expect(await admit(from("2001:db8:0:0:1::4"), "d@example.com")).toBe("source_limited");
    expect(await admit(from("2001:db8:0:1::1"), "e@example.com")).toBe("admitted");
  });

  test("IPv4-mapped IPv6 is the IPv4 source", async () => {
    const admit = local(true);

    for (let i = 0; i < 3; i++) await admit(from("192.0.2.9"), `a${i}@example.com`);
    expect(await admit(from("::ffff:192.0.2.9"), "b@example.com")).toBe("source_limited");
  });
});

describe("process-local fallback", () => {
  test("a full store evicts instead of refusing", async () => {
    const store = memoryStore(() => 0, 2);
    expect(await store.claim("a", 10)).toBe(true);
    expect(await store.increment("b", 10)).toBe(1);
    expect(await store.claim("c", 10)).toBe(true);
    expect(await store.increment("d", 10)).toBe(1);
  });

  test("eviction takes the least recently used entry, so a busy counter survives a flood", async () => {
    const store = memoryStore(() => 0, 2);
    await store.increment("total", 10);

    for (let i = 0; i < 100; i++) {
      await store.increment(`source-${i}`, 10);
      await store.increment("total", 10);
    }

    expect(await store.increment("total", 10)).toBe(102);
  });

  test("expired entries go before live ones", async () => {
    let now = 0;
    const store = memoryStore(() => now, 2);
    expect(await store.claim("short", 5)).toBe(true);
    expect(await store.claim("long", 100)).toBe(true);
    now = 10;
    expect(await store.claim("new", 100)).toBe(true);
    expect(await store.claim("long", 100)).toBe(false);
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
