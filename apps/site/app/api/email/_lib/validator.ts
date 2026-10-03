import {
  GetEmailAddressInsightsCommand,
  SESv2Client,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import { Schema } from "effect";
import { readSesConfig, type EmailEnv } from "./ses";

/** Provider seam: false rejects the recipient, a rejection fails closed, true permits SES. */
export interface EmailValidator {
  validate(email: string): Promise<boolean>;
}

export const fakeValidator: EmailValidator = { validate: async () => true };

export const unavailableValidator: EmailValidator = {
  validate: async () => {
    throw new Error("Email validation unavailable");
  },
};

const Verdict = Schema.Struct({ ConfidenceVerdict: Schema.Literals(["HIGH", "MEDIUM", "LOW"]) });

const Insights = Schema.Struct({
  MailboxValidation: Schema.Struct({
    IsValid: Verdict,
    Evaluations: Schema.Struct({
      HasValidSyntax: Verdict,
      HasValidDnsRecords: Verdict,
      MailboxExists: Verdict,
      IsDisposable: Verdict,
      IsRoleAddress: Verdict,
      IsRandomInput: Verdict,
    }),
  }),
});

type Insights = typeof Insights.Type;

const decodeInsights = Schema.decodeUnknownSync(Insights);

export type ValidationOutcome = "accepted" | "invalid" | "uncertain" | "unavailable";

/** Counts only; no address, domain, request identifier, provider body or error. */
export function createValidationCounters() {
  const counts: Record<ValidationOutcome, number> = {
    accepted: 0,
    invalid: 0,
    uncertain: 0,
    unavailable: 0,
  };

  return {
    record: (outcome: ValidationOutcome) => {
      counts[outcome] += 1;
    },
    snapshot: () => ({ ...counts }),
  };
}

export const validationCounters = createValidationCounters();

export const validationDeadlineMs = 5000;

export type InsightsFactory = (config: SESv2ClientConfig) => {
  send: (
    command: GetEmailAddressInsightsCommand,
    options: { abortSignal: AbortSignal }
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- Untrusted SDK/fake I/O is decoded inside getInsights before returning to callers.
  ) => Promise<unknown>;
  destroy?: () => void;
};

function classifyInsights(input: Insights): ValidationOutcome {
  const { IsValid, Evaluations } = input.MailboxValidation;

  if (IsValid.ConfidenceVerdict === "LOW") return "invalid";

  if (IsValid.ConfidenceVerdict !== "HIGH") return "uncertain";

  const positive = [
    Evaluations.HasValidSyntax,
    Evaluations.HasValidDnsRecords,
    Evaluations.MailboxExists,
  ];

  if (
    positive.some((verdict) => verdict.ConfidenceVerdict === "LOW") ||
    Evaluations.IsDisposable.ConfidenceVerdict === "HIGH"
  )
    return "invalid";

  if (
    positive.some((verdict) => verdict.ConfidenceVerdict !== "HIGH") ||
    Evaluations.IsDisposable.ConfidenceVerdict !== "LOW"
  )
    return "uncertain";

  return "accepted";
}

async function getInsights(client: ReturnType<InsightsFactory>, email: string, deadlineMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Email validation unavailable"));
      controller.abort();
    }, deadlineMs);
  });

  try {
    return decodeInsights(
      await Promise.race([
        client.send(new GetEmailAddressInsightsCommand({ EmailAddress: email }), {
          abortSignal: controller.signal,
        }),
        deadline,
      ])
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createValidator(
  env: EmailEnv,
  makeClient: InsightsFactory = (config) => new SESv2Client(config),
  counters = validationCounters,
  deadlineMs = validationDeadlineMs
): EmailValidator {
  if (env.NODE_ENV !== "production") return fakeValidator;

  return {
    validate: async (email) => {
      let outcome: ValidationOutcome;

      try {
        const config = readSesConfig(env);

        if (!config) throw new Error("Email validation unavailable");

        const client = makeClient({
          ...config,
          requestHandler: { connectionTimeout: 3000, requestTimeout: validationDeadlineMs },
        });

        try {
          outcome = classifyInsights(await getInsights(client, email, deadlineMs));
        } finally {
          client.destroy?.();
        }
      } catch {
        counters.record("unavailable");
        // SDK and schema failures can contain the address; never retain a cause or provider message.
        throw new Error("Email validation unavailable");
      }

      counters.record(outcome);

      if (outcome === "uncertain") throw new Error("Email validation unavailable");

      return outcome === "accepted";
    },
  };
}
