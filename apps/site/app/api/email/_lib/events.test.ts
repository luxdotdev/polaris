import { describe, expect, test } from "bun:test";
import type { WideEvent } from "../../../../lib/log";
import { createEmailHandler } from "./index";
import { EmailValidationError, type EmailValidator } from "./validator";

const email = "private-recipient@example.com";

type Deps = Partial<Parameters<typeof createEmailHandler>[0]>;

function submit(deps: Deps = {}) {
  const handler = createEmailHandler({
    checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
    validator: { validate: async () => true },
    transport: () => ({ preview: false, send: async () => {} }),
    rateLimit: () => 0,
    ...deps,
  });

  const event: WideEvent = {};

  return handler(
    new Request("https://polaris.lux.dev/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website: "" }),
    }),
    event
  ).then((response) => ({ status: response.status, event }));
}

const throwing = (error: Error): EmailValidator => ({
  validate: async () => {
    throw error;
  },
});

describe("email wide event", () => {
  test.each<[string, Deps, number, WideEvent]>([
    [
      "BotID failure",
      {
        checkBot: async () => {
          throw new Error(email);
        },
      },
      503,
      { bot: "unavailable", failure: "botid_unavailable", error: { type: "Error" } },
    ],
    [
      "validator provider error",
      {
        validator: throwing(
          new EmailValidationError("provider", { type: "InvalidIdentityToken", http_status: 400 })
        ),
      },
      503,
      {
        bot: "human",
        validation: "unavailable",
        failure: "validation_provider",
        error: { type: "InvalidIdentityToken", http_status: 400 },
      },
    ],
    [
      "uncertain verdict",
      { validator: throwing(new EmailValidationError("uncertain")) },
      503,
      { validation: "uncertain", failure: "validation_uncertain" },
    ],
    [
      "invalid recipient",
      { validator: { validate: async () => false } },
      422,
      { validation: "invalid" },
    ],
    [
      "missing configuration",
      { transport: () => null, configProblems: () => ["AWS_ROLE_ARN"] },
      503,
      { validation: "accepted", failure: "email_unconfigured", missing_config: ["AWS_ROLE_ARN"] },
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
      503,
      { failure: "send_failed", error: { type: "MessageRejected", http_status: 400 } },
    ],
    ["delivered", {}, 200, { bot: "human", validation: "accepted", delivery: "sent" }],
  ])("%s records why, never the address", async (_, deps, status, fields) => {
    const result = await submit(deps);

    expect(result.status).toBe(status);
    expect(result.event).toMatchObject(fields);
    expect(JSON.stringify(result.event)).not.toContain("private-recipient");
  });
});
