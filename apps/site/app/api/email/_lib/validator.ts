import {
  GetEmailAddressInsightsCommand,
  SESv2Client,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import { Option, Schema } from "effect";
import { errorInfo, type ErrorInfo } from "../../../../lib/log";
import { readSesConfig, type EmailEnv } from "./ses";

/** Provider seam: false rejects the recipient, a rejection fails closed, true permits SES. */
export interface EmailValidator {
  validate(email: string, report?: (verdicts: InsightsVerdicts) => void): Promise<boolean>;
}

export type ValidationFailure = "unconfigured" | "uncertain" | "timeout" | "malformed" | "provider";

/** A fail-closed validation with a loggable reason; its message stays generic. */
export class EmailValidationError extends Error {
  override readonly name = "EmailValidationError";

  constructor(
    readonly reason: ValidationFailure,
    readonly cause_info?: ErrorInfo
  ) {
    super("Email validation unavailable");
  }
}

class ValidationTimeout extends Error {
  override readonly name = "ValidationTimeout";
}

export const decodeEmailValidationError = Schema.decodeUnknownOption(
  Schema.instanceOf(EmailValidationError)
);

export const fakeValidator: EmailValidator = { validate: async () => true };

export const unavailableValidator: EmailValidator = {
  validate: async () => {
    throw new EmailValidationError("unconfigured");
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

/**
 * AWS's overall verdict must be HIGH, with HIGH syntax and DNS and a LOW disposable verdict.
 * Mailbox existence may be MEDIUM: providers such as Gmail block mailbox probing.
 */
function classifyInsights(input: Insights): ValidationOutcome {
  const { IsValid, Evaluations } = input.MailboxValidation;

  if (
    IsValid.ConfidenceVerdict === "LOW" ||
    Evaluations.HasValidSyntax.ConfidenceVerdict === "LOW" ||
    Evaluations.HasValidDnsRecords.ConfidenceVerdict === "LOW" ||
    Evaluations.MailboxExists.ConfidenceVerdict === "LOW" ||
    Evaluations.IsDisposable.ConfidenceVerdict === "HIGH"
  )
    return "invalid";

  if (
    IsValid.ConfidenceVerdict !== "HIGH" ||
    Evaluations.HasValidSyntax.ConfidenceVerdict !== "HIGH" ||
    Evaluations.HasValidDnsRecords.ConfidenceVerdict !== "HIGH" ||
    Evaluations.IsDisposable.ConfidenceVerdict !== "LOW"
  )
    return "uncertain";

  return "accepted";
}

/** The Insights confidence levels, for the request's wide event; no address or domain. */
export type InsightsVerdicts = {
  readonly insights_valid: string;
  readonly insights_syntax: string;
  readonly insights_dns: string;
  readonly insights_mailbox: string;
  readonly insights_disposable: string;
  readonly insights_role: string;
  readonly insights_random: string;
};

function verdicts(input: Insights): InsightsVerdicts {
  const { IsValid, Evaluations } = input.MailboxValidation;

  return {
    insights_valid: IsValid.ConfidenceVerdict,
    insights_syntax: Evaluations.HasValidSyntax.ConfidenceVerdict,
    insights_dns: Evaluations.HasValidDnsRecords.ConfidenceVerdict,
    insights_mailbox: Evaluations.MailboxExists.ConfidenceVerdict,
    insights_disposable: Evaluations.IsDisposable.ConfidenceVerdict,
    insights_role: Evaluations.IsRoleAddress.ConfidenceVerdict,
    insights_random: Evaluations.IsRandomInput.ConfidenceVerdict,
  };
}

async function getInsights(client: ReturnType<InsightsFactory>, email: string, deadlineMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ValidationTimeout());
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

const decodeTimeout = Schema.decodeUnknownOption(Schema.instanceOf(ValidationTimeout));

export function createValidator(
  env: EmailEnv,
  makeClient: InsightsFactory = (config) => new SESv2Client(config),
  counters = validationCounters,
  deadlineMs = validationDeadlineMs
): EmailValidator {
  if (env.NODE_ENV !== "production") return fakeValidator;

  return {
    validate: async (email, report) => {
      let outcome: ValidationOutcome;

      try {
        const config = readSesConfig(env);

        if (!config) throw new EmailValidationError("unconfigured");

        const client = makeClient({
          ...config,
          requestHandler: { connectionTimeout: 3000, requestTimeout: validationDeadlineMs },
        });

        try {
          const insights = await getInsights(client, email, deadlineMs);
          report?.(verdicts(insights));
          outcome = classifyInsights(insights);
        } finally {
          client.destroy?.();
        }
      } catch (error) {
        counters.record("unavailable");
        // SDK and schema failures can contain the address: keep only the error's type and status.

        if (Option.isSome(decodeEmailValidationError(error))) throw error;

        if (Option.isSome(decodeTimeout(error))) throw new EmailValidationError("timeout");

        if (Schema.isSchemaError(error)) throw new EmailValidationError("malformed");

        throw new EmailValidationError("provider", errorInfo(error));
      }

      counters.record(outcome);

      if (outcome === "uncertain") throw new EmailValidationError("uncertain");

      return outcome === "accepted";
    },
  };
}
