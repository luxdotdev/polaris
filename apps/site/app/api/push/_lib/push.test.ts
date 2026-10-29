import { describe, expect, test } from "bun:test";
import {
  type LivePushRequest,
  PushHeaders,
  type PushRequest,
  signPushRequest,
} from "@polaris/protocol/relay";
import { Schema } from "effect";
import type { WideEvent } from "../../../../lib/log";
import { type ApnsReply, type ApnsRequest, FALLBACK_ALERT } from "./apns";
import { PREVIEW, PRODUCTION, type PushDeployment } from "./environment";
import { createPushHandler } from "./index";
import { memoryStore } from "./store";
import { providerTokens } from "./token";

const SECRET = "relay-secret-for-tests-0123456789abcdef";

const TOKEN = "ab".repeat(32);

const PAYLOAD = "c2VhbGVkLWZvci10aGUtZGV2aWNlLW9ubHk";

const NOW = 1_800_000_000_000;

interface Setup {
  readonly deployment?: PushDeployment;
  readonly replies?: Array<ApnsReply>;
  readonly secret?: string | null;
}

const setup = ({ deployment = PREVIEW, replies = [], secret = SECRET }: Setup = {}) => {
  const sent: Array<ApnsRequest> = [];
  let signed = 0;
  const store = memoryStore(() => NOW);

  const handler = createPushHandler({
    secret,
    deployment,
    store,
    tokens: providerTokens({
      store,
      now: () => NOW,
      sign: async (issuer) => `jwt-${issuer.keyId}-${++signed}`,
    }),
    send: async (request) => {
      sent.push(request);

      return replies.shift() ?? { status: 200, reason: null };
    },
    now: () => NOW,
  });

  return { handler, sent, signed: () => signed };
};

const signedRequest = async (
  body: PushRequest | LivePushRequest,
  options: { timestamp?: number; nonce?: string; secret?: string } = {}
) => {
  const text = JSON.stringify(body);
  const timestamp = String(options.timestamp ?? NOW / 1000);
  const nonce = options.nonce ?? crypto.randomUUID().replaceAll("-", "");
  const path = "/api/push";

  const signature = await signPushRequest(options.secret ?? SECRET, {
    method: "POST",
    path,
    timestamp,
    nonce,
    body: text,
  });

  return new Request(`https://polaris.lux.dev${path}`, {
    method: "POST",
    headers: {
      [PushHeaders.timestamp]: timestamp,
      [PushHeaders.nonce]: nonce,
      [PushHeaders.signature]: signature,
    },
    body: text,
  });
};

const body = (environment: PushRequest["environment"] = "sandbox"): PushRequest => ({
  token: TOKEN,
  environment,
  payload: PAYLOAD,
});

const decodeLiveBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      aps: Schema.Struct({
        "content-state": Schema.Unknown,
        "stale-date": Schema.Number,
        alert: Schema.optionalKey(Schema.Unknown),
      }),
    })
  )
);

const run = async (handler: ReturnType<typeof setup>["handler"], request: Request) => {
  const event: WideEvent = {};
  const response = await handler(request, event);

  return { status: response.status, json: await response.text(), event };
};

describe("POST /api/push", () => {
  test("a signed request reaches APNs with the device token, topic and sealed payload, and the event holds neither", async () => {
    const { handler, sent } = setup();
    const { status, json, event } = await run(handler, await signedRequest(body()));

    expect(status).toBe(200);
    expect(JSON.parse(json)).toEqual({ outcome: "sent" });
    expect(sent).toEqual([
      {
        origin: "https://api.sandbox.push.apple.com",
        providerToken: "jwt-NU22YH4SRB-1",
        deviceToken: TOKEN,
        topic: "dev.lux.polaris.mobile",
        pushType: "alert",
        priority: 10,
        body: JSON.stringify({
          aps: { alert: FALLBACK_ALERT, "mutable-content": 1, sound: "default" },
          p: PAYLOAD,
        }),
        expiration: NOW / 1000 + 3600,
      },
    ]);
    const logged = JSON.stringify(event);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(PAYLOAD);
    expect(logged).not.toContain("jwt-");
  });

  test.each([
    [false, 5, undefined],
    [true, 10, { title: "Polaris", body: "An agent session needs you." }],
  ])(
    "a Live Activity update (alert %p) goes as liveactivity at priority %p",
    async (alert, priority, shown) => {
      const { handler, sent } = setup();
      const state = { v: 1 as const, slices: [PAYLOAD, PAYLOAD] };
      const timestamp = NOW / 1000;

      const live: LivePushRequest = {
        token: TOKEN,
        environment: "sandbox",
        live: { event: "update", timestamp, state, alert },
      };

      const { status, event } = await run(handler, await signedRequest(live));

      expect(status).toBe(200);
      expect(
        sent.map(({ topic, pushType, priority, expiration }) => [
          topic,
          pushType,
          priority,
          expiration,
        ])
      ).toEqual([
        [
          "dev.lux.polaris.mobile.push-type.liveactivity",
          "liveactivity",
          priority,
          timestamp + 900,
        ],
      ]);
      const { aps } = decodeLiveBody(sent[0]?.body ?? "");
      expect(aps["content-state"]).toEqual(state);
      expect(aps["stale-date"]).toBe(timestamp + 900);
      expect(aps.alert).toEqual(shown);
      expect(JSON.stringify(event)).not.toContain(PAYLOAD);
    }
  );

  test("a Live Activity update to an ended activity is unregistered, as for alerts", async () => {
    const { handler } = setup({ replies: [{ status: 410, reason: "Unregistered" }] });

    const live: LivePushRequest = {
      token: TOKEN,
      environment: "sandbox",
      live: { event: "update", timestamp: NOW / 1000, state: { v: 1, slices: [] }, alert: false },
    };

    const result = await run(handler, await signedRequest(live));

    expect([result.status, JSON.parse(result.json)]).toEqual([410, { outcome: "unregistered" }]);
  });

  test.each([
    ["a stale timestamp", { timestamp: NOW / 1000 - 61 }, "stale"],
    ["a future timestamp", { timestamp: NOW / 1000 + 61 }, "stale"],
    ["another secret", { secret: "someone-else-entirely-0123456789" }, "bad_signature"],
  ])("%s is refused before APNs", async (_name, options, rejection) => {
    const { handler, sent } = setup();
    const { status, event } = await run(handler, await signedRequest(body(), options));

    expect(status).toBe(401);
    expect(event.rejection).toBe(rejection);
    expect(sent).toEqual([]);
  });

  test("a body changed after signing is refused", async () => {
    const { handler, sent } = setup();
    const original = await signedRequest(body());

    const tampered = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify({ ...body(), token: "cd".repeat(32) }),
    });

    expect((await run(handler, tampered)).status).toBe(401);
    expect(sent).toEqual([]);
  });

  test("a replayed request is refused the second time", async () => {
    const { handler, sent } = setup();
    const nonce = "same-nonce-0123456789";

    expect((await run(handler, await signedRequest(body(), { nonce }))).status).toBe(200);
    const again = await run(handler, await signedRequest(body(), { nonce }));
    expect(again.status).toBe(401);
    expect(again.event.rejection).toBe("replayed");
    expect(sent).toHaveLength(1);
  });

  test("a preview deployment refuses production device tokens and never reaches production APNs", async () => {
    const { handler, sent } = setup({ deployment: PREVIEW });
    const { status, json } = await run(handler, await signedRequest(body("production")));

    expect(status).toBe(400);
    expect(JSON.parse(json)).toEqual({ outcome: "refused" });
    expect(sent).toEqual([]);
  });

  test("production sends each token to its own endpoint with the production key", async () => {
    const { handler, sent } = setup({ deployment: PRODUCTION });

    await run(handler, await signedRequest(body("production")));
    await run(handler, await signedRequest(body("sandbox")));
    expect(sent.map((r) => [r.origin, r.providerToken])).toEqual([
      ["https://api.push.apple.com", "jwt-5L5G3J789G-1"],
      ["https://api.sandbox.push.apple.com", "jwt-5L5G3J789G-1"],
    ]);
  });

  test.each([
    [{ status: 410, reason: "Unregistered" }, 410, "unregistered"],
    [{ status: 400, reason: "BadDeviceToken" }, 410, "unregistered"],
    [{ status: 429, reason: "TooManyRequests" }, 429, "rate-limited"],
    [{ status: 503, reason: "ServiceUnavailable" }, 503, "unavailable"],
    [{ status: 400, reason: "PayloadTooLarge" }, 400, "refused"],
  ])("APNs %p becomes %p %p", async (reply, status, outcome) => {
    const { handler } = setup({ replies: [reply] });
    const result = await run(handler, await signedRequest(body()));

    expect([result.status, JSON.parse(result.json)]).toEqual([status, { outcome }]);
    expect(result.event.apns_reason).toBe(reply.reason);
  });

  test("an expired provider token is replaced once and the push retried", async () => {
    const { handler, sent, signed } = setup({
      replies: [{ status: 403, reason: "ExpiredProviderToken" }],
    });

    const { status } = await run(handler, await signedRequest(body()));

    expect(status).toBe(200);
    expect(sent.map((r) => r.providerToken)).toEqual(["jwt-NU22YH4SRB-1", "jwt-NU22YH4SRB-2"]);
    expect(signed()).toBe(2);
  });

  test("a body over the limit is refused without reading it all, even with no Content-Length", async () => {
    const { handler, sent } = setup();
    let pulled = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled++;
        controller.enqueue(new Uint8Array(4096));
      },
    });

    const request = new Request("https://polaris.lux.dev/api/push", {
      method: "POST",
      body: stream,
    });

    expect((await run(handler, request)).status).toBe(400);
    expect(pulled).toBeLessThan(10);
    expect(sent).toEqual([]);
  });

  test("without POLARIS_PUSH_SECRET nothing is sent", async () => {
    const { handler, sent } = setup({ secret: null });

    expect((await run(handler, await signedRequest(body()))).status).toBe(503);
    expect(sent).toEqual([]);
  });
});
