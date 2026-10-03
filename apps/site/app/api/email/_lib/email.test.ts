import { describe, expect, test } from "bun:test";
import { SendEmailCommand, type SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { createEmailHandler } from "./index";
import { createRateLimit, windowMs } from "./rate-limit";
import { createTransport, type EmailEnv, type SesFactory } from "./transport";
import { validEmail } from "./validation";
import { fakeValidator } from "./validator";

const configured: EmailEnv = {
  NODE_ENV: "production",
  AWS_REGION: "us-east-1",
  POLARIS_EMAIL_FROM: "download@example.com",
  POLARIS_EMAIL_CONFIGURATION_SET: "polaris-download",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/polaris-download-email",
};

const submission = (
  body: null | Record<string, string | number> = { email: "ada@example.com", website: "" },
  headers: Readonly<Record<string, string>> = {}
) =>
  new Request("https://polaris.lux.dev/api/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

function fixture(env: EmailEnv = configured) {
  const sent: SendEmailCommand[] = [];
  let logs = 0;
  const limit = createRateLimit();

  const handler = createEmailHandler({
    validator: fakeValidator,
    checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
    transport: () =>
      createTransport(env, () => ({
        send: async (command) => {
          sent.push(command);

          return {};
        },
      })),
    rateLimit: (headers) => limit(headers, true),
    requested: () => {
      logs += 1;
    },
  });

  return { handler, sent, logs: () => logs };
}

describe("email endpoint", () => {
  test("sends one SESv2 email (HTML and plain text) with download and source links", async () => {
    const f = fixture();
    const response = await f.handler(submission({ email: " ada+mac@example.com ", website: "" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(f.logs()).toBe(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toBeInstanceOf(SendEmailCommand);
    expect(f.sent[0]?.input).toMatchObject({
      FromEmailAddress: "download@example.com",
      ConfigurationSetName: "polaris-download",
      Destination: { ToAddresses: ["ada+mac@example.com"] },
      Content: { Simple: { Subject: { Data: "Polaris for Mac", Charset: "UTF-8" } } },
    });
    const body = f.sent[0]?.input.Content?.Simple?.Body;
    expect(body?.Text?.Data).toContain("https://polaris.lux.dev/download/mac");
    expect(body?.Text?.Data).toContain("https://github.com/luxdotdev/polaris");
    expect(body?.Html?.Data).toContain('href="https://polaris.lux.dev/download/mac"');
    expect(body?.Html?.Data).toContain("https://polaris.lux.dev/email/dawn.png");
    expect(body?.Html?.Data).not.toContain("ada+mac");
    expect(await response.text()).not.toContain("ada");
  });

  test.each([
    null,
    {},
    { email: 12, website: "" },
    { email: "x@example.com" },
    { email: "x@example.com\r\nBcc:private@example.com", website: "" },
    { email: "x@@example.com", website: "" },
    { email: "x@-bad.com", website: "" },
    { email: "x".repeat(2049), website: "" },
  ])("rejects malformed submission %# without sending or telemetry", async (input) => {
    const f = fixture();
    expect((await f.handler(submission(input))).status).toBe(400);
    expect(f.sent).toHaveLength(0);
    expect(f.logs()).toBe(0);
  });

  test("honeypot returns an innocuous success without transport or telemetry", async () => {
    const f = fixture();
    expect(
      (await f.handler(submission({ email: "ada@example.com", website: "bot.example" }))).status
    ).toBe(200);
    expect(f.sent).toHaveLength(0);
    expect(f.logs()).toBe(0);
  });

  test("fourth request from one IP is limited, another IP is separate", async () => {
    const f = fixture();

    for (let i = 0; i < 3; i++)
      expect(
        (await f.handler(submission(undefined, { "x-vercel-forwarded-for": "192.0.2.1" }))).status
      ).toBe(200);

    const blocked = await f.handler(
      submission(undefined, { "x-vercel-forwarded-for": "192.0.2.1" })
    );

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(
      (await f.handler(submission(undefined, { "x-vercel-forwarded-for": "192.0.2.2" }))).status
    ).toBe(200);
    expect(f.sent).toHaveLength(4);
    expect(f.logs()).toBe(4);
  });

  test("unconfigured production fails closed", async () => {
    const f = fixture({ NODE_ENV: "production" });
    const response = await f.handler(submission());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not available yet");
    expect(f.sent).toHaveLength(0);
    expect(f.logs()).toBe(1);
  });

  test("provider failure discards private details", async () => {
    const handler = createEmailHandler({
      validator: fakeValidator,
      checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
      transport: () => ({
        preview: false,
        send: async () => {
          throw new Error("ada@example.com 192.0.2.1");
        },
      }),
      rateLimit: () => 0,
      requested: () => {},
    });

    const response = await handler(submission());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("ada@example.com");
  });

  test("cross-origin and non-JSON browser submissions cannot send", async () => {
    const f = fixture();
    expect(
      (await f.handler(submission(undefined, { Origin: "https://other.example" }))).status
    ).toBe(403);
    expect((await f.handler(submission(undefined, { "Content-Type": "text/plain" }))).status).toBe(
      415
    );
    expect(f.sent).toHaveLength(0);
  });

  test("same-origin check uses the public Host when Next normalizes its internal URL", async () => {
    const f = fixture();

    const input = new Request("http://localhost:3188/api/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3188",
        Origin: "http://127.0.0.1:3188",
      },
      body: JSON.stringify({ email: "ada@example.com", website: "" }),
    });

    expect((await f.handler(input)).status).toBe(200);
    expect(f.sent).toHaveLength(1);
  });

  test("development ignores real credentials, performs no SES call and labels preview", async () => {
    const f = fixture({ ...configured, NODE_ENV: "development" });
    const response = await f.handler(submission());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Polaris-Email-Preview")).toBe("1");
    expect(f.sent).toHaveLength(0);
  });
});

describe("transport configuration", () => {
  test.each([
    { ...configured, AWS_REGION: "" },
    { ...configured, POLARIS_EMAIL_CONFIGURATION_SET: "" },
    { ...configured, POLARIS_EMAIL_FROM: "bad" },
    { ...configured, AWS_ROLE_ARN: "" },
    { ...configured, AWS_ROLE_ARN: "not-an-arn" },
    {
      ...configured,
      AWS_ROLE_ARN: "",
      AWS_ACCESS_KEY_ID: "static-key",
      AWS_SECRET_ACCESS_KEY: "static-secret",
    },
    { ...configured, POLARIS_EMAIL_TRANSPORT: "fake" },
  ])("fails closed before creating a client %#", (env) => {
    let calls = 0;
    expect(
      createTransport(env, () => {
        calls++;
        throw new Error("must not run");
      })
    ).toBeNull();
    expect(calls).toBe(0);
  });

  test("credentials come from the Vercel OIDC role and retries are bounded", () => {
    const configs: SESv2ClientConfig[] = [];

    const factory: SesFactory = (config) => {
      configs.push(config);

      return { send: async () => ({}) };
    };

    expect(
      createTransport(
        {
          NODE_ENV: "production",
          AWS_REGION: "us-east-1",
          POLARIS_EMAIL_FROM: "download@example.com",
          POLARIS_EMAIL_CONFIGURATION_SET: "polaris-download",
          AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/polaris-download-email",
        },
        factory
      )
    ).not.toBeNull();
    expect(configs[0]?.credentials).toBeInstanceOf(Function);
    expect(configs[0]?.maxAttempts).toBe(1);
  });
});

describe("abuse guard", () => {
  test("window resets, missing/untrusted headers share a bounded fallback", () => {
    let now = 0;
    const limit = createRateLimit(() => now);

    for (let i = 0; i < 3; i++)
      expect(limit(new Headers({ "x-vercel-forwarded-for": `192.0.2.${i}` }), false)).toBe(0);
    expect(limit(new Headers(), false)).toBe(900);
    now = windowMs;
    expect(limit(new Headers(), false)).toBe(0);
  });

  test("IPv6 spellings share a bucket; spoofed forwarded-for is ignored", () => {
    const limit = createRateLimit(() => 0);
    const headers = new Headers({ "x-vercel-forwarded-for": "2001:db8::1" });

    for (let i = 0; i < 3; i++) expect(limit(headers, true)).toBe(0);
    expect(limit(new Headers({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }), true)).toBe(
      900
    );
    const fallback = createRateLimit(() => 0);

    for (let i = 0; i < 3; i++)
      expect(fallback(new Headers({ "x-forwarded-for": `192.0.2.${i}` }), true)).toBe(0);
    expect(fallback(new Headers({ "x-forwarded-for": "192.0.2.10" }), true)).toBe(900);
  });

  test("per-instance ceiling bounds sends and map growth", () => {
    const limit = createRateLimit(() => 0);

    for (let i = 0; i < 100; i++)
      expect(limit(new Headers({ "x-vercel-forwarded-for": `192.0.2.${i}` }), true)).toBe(0);
    expect(limit(new Headers({ "x-vercel-forwarded-for": "192.0.2.200" }), true)).toBe(900);
  });

  test.each([
    ".ada@example.com",
    "ada..x@example.com",
    "ada@example..com",
    "ada@localhost",
    "x".repeat(65) + "@example.com",
    "Ada <ada@example.com>",
  ])("invalid email %s", (email) => {
    expect(validEmail(email)).toBe(false);
  });
});
