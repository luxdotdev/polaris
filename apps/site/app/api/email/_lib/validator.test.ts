import { describe, expect, spyOn, test } from "bun:test";
import { GetEmailAddressInsightsCommand, type SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { createEmailHandler } from "./index";
import { createTransport } from "./transport";
import {
  createValidationCounters,
  createValidator,
  validationDeadlineMs,
  type InsightsFactory,
} from "./validator";

const env = {
  NODE_ENV: "production",
  AWS_REGION: "us-east-1",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/polaris-download-email",
  POLARIS_EMAIL_FROM: "download@example.com",
  POLARIS_EMAIL_CONFIGURATION_SET: "polaris-download",
};

const email = "private-recipient@example.com";

const verdict = (ConfidenceVerdict: string) => ({ ConfidenceVerdict });

const good = () => ({
  MailboxValidation: {
    IsValid: verdict("HIGH"),
    Evaluations: {
      HasValidSyntax: verdict("HIGH"),
      HasValidDnsRecords: verdict("HIGH"),
      MailboxExists: verdict("HIGH"),
      IsDisposable: verdict("LOW"),
      IsRoleAddress: verdict("LOW"),
      IsRandomInput: verdict("LOW"),
    },
  },
});

function handlerFixture(
  send: ReturnType<InsightsFactory>["send"],
  deadlineMs = validationDeadlineMs
) {
  let sent = 0;
  let opened = 0;
  let destroyed = 0;
  const counters = createValidationCounters();

  const validator = createValidator(
    env,
    () => ({
      send,
      destroy: () => {
        destroyed++;
      },
    }),
    counters,
    deadlineMs
  );

  const telemetry: string[] = [];

  const handler = createEmailHandler({
    checkBot: async () => ({ isBot: false, isVerifiedBot: false }),
    validator,
    rateLimit: () => 0,
    transport: () => {
      opened++;

      return {
        preview: false,
        send: async () => {
          sent++;
        },
      };
    },
  });

  const request = async () => {
    const event = {};

    const response = await handler(
      new Request("https://polaris.lux.dev/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website: "" }),
      }),
      event
    );

    telemetry.push(JSON.stringify(event));

    return response;
  };

  return {
    request,
    sent: () => sent,
    opened: () => opened,
    destroyed: () => destroyed,
    counters,
    telemetry,
  };
}

const outcomes: Array<{ label: string; response: unknown; status: number; outcome: string }> = [
  { label: "deliverable", response: good(), status: 200, outcome: "accepted" },
  ...["HIGH", "MEDIUM", "LOW"].map((role) => {
    const response = good();
    response.MailboxValidation.Evaluations.IsRoleAddress = verdict(role);

    return { label: `role ${role} allowed`, response, status: 200, outcome: "accepted" };
  }),
  ...["LOW", "MEDIUM"].map((overall) => {
    const response = good();
    response.MailboxValidation.IsValid = verdict(overall);

    return {
      label: `overall ${overall}`,
      response,
      status: overall === "LOW" ? 422 : 503,
      outcome: overall === "LOW" ? "invalid" : "uncertain",
    };
  }),
  ...["HasValidSyntax", "HasValidDnsRecords", "MailboxExists", "IsDisposable"].flatMap((field) =>
    ["LOW", "MEDIUM", "HIGH"].map((value) => {
      const response = good();
      const evaluations = { ...response.MailboxValidation.Evaluations, [field]: verdict(value) };
      const accepts = field === "IsDisposable" ? value === "LOW" : value === "HIGH";
      const invalid = field === "IsDisposable" ? value === "HIGH" : value === "LOW";

      return {
        label: `${field} ${value}`,
        response: {
          MailboxValidation: { ...response.MailboxValidation, Evaluations: evaluations },
        },
        status: accepts ? 200 : invalid ? 422 : 503,
        outcome: accepts ? "accepted" : invalid ? "invalid" : "uncertain",
      };
    })
  ),
  ...[null, {}, "malformed JSON", { MailboxValidation: {} }].map((response) => ({
    label: "missing or malformed response",
    response,
    status: 503,
    outcome: "unavailable",
  })),
  ...[
    "HasValidSyntax",
    "HasValidDnsRecords",
    "MailboxExists",
    "IsDisposable",
    "IsRoleAddress",
    "IsRandomInput",
  ].flatMap((field) =>
    [undefined, verdict("UNKNOWN"), verdict("true"), verdict(email)].map((value) => ({
      label: `${field} missing/unrecognized`,
      response: {
        MailboxValidation: {
          ...good().MailboxValidation,
          Evaluations: { ...good().MailboxValidation.Evaluations, [field]: value },
        },
      },
      status: 503,
      outcome: "unavailable",
    }))
  ),
  ...[undefined, verdict("UNKNOWN"), verdict(email)].map((value) => ({
    label: "overall missing/unrecognized",
    response: { MailboxValidation: { ...good().MailboxValidation, IsValid: value } },
    status: 503,
    outcome: "unavailable",
  })),
];

describe("SES Insights route mapping", () => {
  test.each(outcomes)("$label → $status", async ({ response, status, outcome }) => {
    const f = handlerFixture(async () => response);
    const result = await f.request();
    expect(result.status).toBe(status);
    expect(f.sent()).toBe(status === 200 ? 1 : 0);
    expect(f.opened()).toBe(status === 200 ? 1 : 0);
    expect(f.destroyed()).toBe(1);
    expect(f.counters.snapshot()).toEqual({
      accepted: 0,
      invalid: 0,
      uncertain: 0,
      unavailable: 0,
      [outcome]: 1,
    });
    expect(await result.text()).not.toContain(email);
    expect(JSON.stringify(f.telemetry)).not.toContain(email);
  });

  test.each([400, 401, 402, 429, 500, 503])(
    "provider HTTP %i discards details and never sends or retries",
    async (status) => {
      let calls = 0;

      const f = handlerFixture(async () => {
        calls++;
        throw Object.assign(new Error(email), {
          $metadata: { httpStatusCode: status },
          address: email,
        });
      });

      const response = await f.request();
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(email);
      expect(f.sent()).toBe(0);
      expect(f.opened()).toBe(0);
      expect(calls).toBe(1);
      expect(f.counters.snapshot().unavailable).toBe(1);
    }
  );

  test("5 s deadline aborts a client that never settles; no later send", async () => {
    let signal: AbortSignal | undefined;
    let finish: ((result: ReturnType<typeof good>) => void) | undefined;

    const f = handlerFixture((_, options) => {
      signal = options.abortSignal;

      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const response = await f.request();
    expect(validationDeadlineMs).toBe(5000);
    expect(response.status).toBe(503);
    expect(signal?.aborted).toBe(true);
    expect(f.sent()).toBe(0);
    expect(f.destroyed()).toBe(1);
    finish?.(good());
    await Promise.resolve();
    expect(f.sent()).toBe(0);
    expect(f.counters.snapshot()).toEqual({
      accepted: 0,
      invalid: 0,
      uncertain: 0,
      unavailable: 1,
    });
  }, 7000);

  test("abort rejection and ordinary network failure fail closed", async () => {
    for (const failure of [new DOMException(email, "AbortError"), new Error(email)]) {
      const f = handlerFixture(async () => {
        throw failure;
      });

      expect((await f.request()).status).toBe(503);
      expect(f.sent()).toBe(0);
      expect(f.counters.snapshot().unavailable).toBe(1);
    }
  });
});

describe("SES Insights configuration and privacy", () => {
  test("uses the send Region and OIDC role, one attempt, signed body command and bounded timeout", async () => {
    const configs: SESv2ClientConfig[] = [];

    const validator = createValidator(
      { ...env, AWS_ACCESS_KEY_ID: "static-key", AWS_SECRET_ACCESS_KEY: "static-secret" },
      (config) => {
        configs.push(config);

        return {
          send: async (command, options) => {
            expect(command).toBeInstanceOf(GetEmailAddressInsightsCommand);
            expect(command.input).toEqual({ EmailAddress: email });
            expect(options.abortSignal.aborted).toBe(false);

            return good();
          },
        };
      },
      createValidationCounters()
    );

    expect(await validator.validate(email)).toBe(true);
    createTransport(env, (config) => {
      configs.push(config);

      return { send: async () => ({}) };
    });
    expect(configs[0]?.region).toBe(configs[1]?.region);
    // Static keys in the environment are ignored: credentials always come from the role.
    expect(configs[0]?.credentials).toBeInstanceOf(Function);
    expect(configs[1]?.credentials).toBeInstanceOf(Function);
    expect(configs[0]?.maxAttempts).toBe(1);
    expect(configs[0]?.requestHandler).toEqual({ connectionTimeout: 3000, requestTimeout: 5000 });
  });

  test.each([
    { AWS_REGION: "" },
    { POLARIS_EMAIL_FROM: "bad" },
    { AWS_ROLE_ARN: "" },
    { AWS_ROLE_ARN: "arn:aws:iam::123456789012:user/static" },
    { AWS_ROLE_ARN: "", AWS_ACCESS_KEY_ID: "static-key", AWS_SECRET_ACCESS_KEY: "static-secret" },
    { POLARIS_EMAIL_TRANSPORT: "fake" },
    { POLARIS_EMAIL_CONFIGURATION_SET: "" },
  ])("unconfigured production never creates a client %#", async (missing) => {
    let calls = 0;

    const validator = createValidator(
      { ...env, ...missing },
      () => {
        calls++;
        throw new Error(email);
      },
      createValidationCounters()
    );

    await validator.validate(email).then(
      () => {
        throw new Error("Expected validation to fail");
      },
      (error) => {
        expect(String(error)).toBe("EmailValidationError: Email validation unavailable");
      }
    );
    expect(calls).toBe(0);
  });

  test.each(["development", "test"])("%s is fake despite AWS credentials", async (NODE_ENV) => {
    const counters = createValidationCounters();

    const validator = createValidator(
      { ...env, NODE_ENV },
      () => {
        throw new Error("must not call AWS");
      },
      counters
    );

    expect(await validator.validate(email)).toBe(true);
    expect(counters.snapshot()).toEqual({ accepted: 0, invalid: 0, uncertain: 0, unavailable: 0 });
  });

  test("SDK and schema errors leave no cause, log, trace or PII telemetry", async () => {
    const spies = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];

    try {
      for (const send of [
        async () => {
          throw new Error(email);
        },
        async () => ({ MailboxValidation: email }),
      ]) {
        const validator = createValidator(env, () => ({ send }), createValidationCounters());

        try {
          await validator.validate(email);
          throw new Error("expected validation to fail");
        } catch (error) {
          expect(String(error)).toBe("EmailValidationError: Email validation unavailable");
          expect(error).not.toHaveProperty("cause");
          expect(String(error)).not.toContain(email);
        }

        const f = handlerFixture(send);
        expect((await f.request()).status).toBe(503);
        expect(JSON.stringify(f.telemetry)).not.toContain(email);
        expect(JSON.stringify(f.counters.snapshot())).not.toContain(email);
      }

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
