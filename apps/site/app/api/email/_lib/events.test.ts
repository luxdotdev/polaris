import { describe, expect, test } from "bun:test";
import type { Level, WideEvent } from "../../../../lib/log";
import { createEmailHandler } from "./index";
import type { Admission } from "./limiter";
import { EmailValidationError, type EmailValidator } from "./validator";

const email = "private-recipient@example.com";

type Deps = Partial<Parameters<typeof createEmailHandler>[0]>;

async function submit(deps: Deps = {}) {
  const tasks: Array<() => Promise<Level | void>> = [];

  const handler = createEmailHandler({
    checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
    validator: { validate: async () => true },
    transport: () => ({ preview: false, send: async () => {} }),
    admit: async () => "admitted",
    preview: false,
    ...deps,
  });

  const event: WideEvent = {};

  const response = await handler(
    new Request("https://polaris.lux.dev/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website: "" }),
    }),
    event,
    (task) => tasks.push(task)
  );

  const reply = {
    status: response.status,
    headers: [...response.headers.entries()],
    body: await response.text(),
  };

  const levels = await Promise.all(tasks.map((task) => task()));

  return { reply, event, levels };
}

const throwing = (error: Error): EmailValidator => ({
  validate: async () => {
    throw error;
  },
});

const limited = (admission: Admission): Deps => ({ admit: async () => admission });

describe("every well-formed submission looks the same from outside", () => {
  test.each<[string, Deps, WideEvent, Level]>([
    [
      "validator provider error",
      {
        validator: throwing(
          new EmailValidationError("provider", { type: "InvalidIdentityToken", http_status: 400 })
        ),
      },
      {
        bot: "human",
        validation: "unavailable",
        failure: "validation_provider",
        error: { type: "InvalidIdentityToken", http_status: 400 },
      },
      "error",
    ],
    [
      "uncertain verdict",
      { validator: throwing(new EmailValidationError("uncertain")) },
      { validation: "uncertain", failure: "validation_uncertain" },
      "info",
    ],
    [
      "invalid recipient",
      { validator: { validate: async () => false } },
      { validation: "invalid" },
      "info",
    ],
    ["source limited", limited("source_limited"), { rejection: "source_limited" }, "info"],
    ["total limited", limited("total_limited"), { rejection: "total_limited" }, "info"],
    [
      "recipient cooldown",
      limited("recipient_cooldown"),
      { rejection: "recipient_cooldown" },
      "info",
    ],
    [
      "limiter unavailable",
      {
        admit: async () => {
          throw new TypeError(email);
        },
      },
      { failure: "limiter_unavailable", error: { type: "TypeError" } },
      "error",
    ],
    [
      "missing configuration",
      { transport: () => null, configProblems: () => ["AWS_ROLE_ARN"] },
      { validation: "accepted", failure: "email_unconfigured", missing_config: ["AWS_ROLE_ARN"] },
      "error",
    ],
    [
      "SES send failure",
      {
        transport: () => ({
          preview: false,
          send: async () => {
            throw Object.assign(new Error(`Rejected ${email}`), {
              name: "MessageRejected",
              $metadata: { httpStatusCode: 400 },
            });
          },
        }),
      },
      { failure: "send_failed", error: { type: "MessageRejected", http_status: 400 } },
      "error",
    ],
  ])(
    "%s replies as a delivery does and records why, never the address",
    async (_, deps, fields, level) => {
      const delivered = await submit();
      const result = await submit(deps);

      expect(delivered.event).toMatchObject({
        bot: "human",
        validation: "accepted",
        delivery: "sent",
      });
      expect(result.reply).toEqual(delivered.reply);
      expect(result.reply.status).toBe(202);
      expect(result.event).toMatchObject(fields);
      expect(result.levels).toEqual([level]);
      expect(JSON.stringify(result.event)).not.toContain("private-recipient");
    }
  );

  test("the reply goes out before validation or sending has settled", async () => {
    let release = () => {};

    const tasks: Array<() => Promise<Level | void>> = [];

    const handler = createEmailHandler({
      checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
      admit: async () => "admitted",
      preview: false,
      validator: {
        validate: () =>
          new Promise((resolve) => {
            release = () => resolve(true);
          }),
      },
      transport: () => ({ preview: false, send: async () => {} }),
    });

    const event: WideEvent = {};

    const response = await handler(
      new Request("https://polaris.lux.dev/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website: "" }),
      }),
      event,
      (task) => tasks.push(task)
    );

    expect(response.status).toBe(202);
    const settled = Promise.all(tasks.map((task) => task()));
    await Promise.resolve();
    expect(event.delivery).toBeUndefined();
    release();
    await settled;
    expect(event.delivery).toBe("sent");
  });

  test("BotID failure records why, never the address", async () => {
    const result = await submit({
      checkBot: async () => {
        throw new Error(email);
      },
    });

    expect(result.reply.status).toBe(503);
    expect(result.event).toMatchObject({
      bot: "unavailable",
      failure: "botid_unavailable",
      error: { type: "Error" },
    });
    expect(JSON.stringify(result.event)).not.toContain("private-recipient");
  });
});
