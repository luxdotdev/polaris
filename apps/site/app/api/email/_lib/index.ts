import { errorInfo, type WideEvent } from "../../../../lib/log";
import type { EmailTransport } from "./transport";
import type { BotCheck } from "./bot";
import { Option } from "effect";
import {
  decodeEmailValidationError,
  EmailValidationError,
  unavailableValidator,
  type EmailValidator,
} from "./validator";
import { readSubmission, validEmail } from "./validation";

type Dependencies = {
  checkBot: BotCheck;
  validator?: EmailValidator;
  transport: () => EmailTransport | null;
  rateLimit: (headers: Headers) => number;
  /** Names of missing or invalid settings, recorded when the transport is unavailable. */
  configProblems?: () => readonly string[];
  requested?: () => void;
};

/** Tells the form why a 422 happened, so it can explain an address it couldn't confirm. */
export const REASON_HEADER = "X-Polaris-Email-Reason";

function reply(status: number, message: string, headers?: Readonly<Record<string, string>>) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}

/** Bot detection first; any detection failure fails closed. */
async function botGate(checkBot: BotCheck, request: Request, event: WideEvent) {
  try {
    const verification = await checkBot(request);

    if (verification.isVerifiedBot) event.bot = "verified_bot";
    else event.bot = verification.isBot ? "bot" : "human";

    if (verification.isBot || verification.isVerifiedBot)
      return reply(403, "This request was blocked. Please try again from your browser.");
  } catch (error) {
    event.bot = "unavailable";
    event.failure = "botid_unavailable";
    event.error = errorInfo(error);

    return reply(503, "Email is unavailable. Please try again later.");
  }

  return null;
}

function requestGate(request: Request, event: WideEvent) {
  const origin = request.headers.get("origin");
  const publicUrl = new URL(request.url);
  const host = request.headers.get("host");

  // Next can normalize the internal URL to localhost in development; Host is the browser's authority.
  if (host) publicUrl.host = host;

  if (origin && origin !== publicUrl.origin) {
    event.rejection = "origin_mismatch";

    return reply(403, "Send this form from the Polaris site.");
  }

  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    event.rejection = "content_type";

    return reply(415, "Send the email form as JSON.");
  }

  return null;
}

function validationFailure(failure: EmailValidationError, event: WideEvent) {
  event.validation = failure.reason === "uncertain" ? "uncertain" : "unavailable";
  event.failure = `validation_${failure.reason}`;

  if (failure.cause_info) event.error = failure.cause_info;
}

async function deliver(
  deps: Dependencies,
  validator: EmailValidator,
  email: string,
  event: WideEvent
) {
  try {
    const accepted = await validator.validate(email, (verdicts) => Object.assign(event, verdicts));
    event.validation = accepted ? "accepted" : "invalid";

    if (!accepted) return reply(422, "Use another email address.");
  } catch (error) {
    const failure = Option.getOrElse(
      decodeEmailValidationError(error),
      () => new EmailValidationError("provider", errorInfo(error))
    );

    validationFailure(failure, event);

    if (failure.reason === "uncertain")
      return reply(
        422,
        "We couldn't confirm that address. Check it, or download Polaris on your Mac at polaris.lux.dev.",
        { [REASON_HEADER]: "unconfirmed" }
      );

    return reply(503, "The email could not be sent. Please try again later.");
  }

  const sender = deps.transport();

  if (!sender) {
    event.failure = "email_unconfigured";
    event.missing_config = deps.configProblems?.() ?? [];

    return reply(503, "Email is not available yet. Please try again later.");
  }

  try {
    await sender.send(email);
  } catch (error) {
    event.failure = "send_failed";
    event.error = errorInfo(error);

    return reply(503, "The email could not be sent. Please try again later.");
  }

  event.delivery = sender.preview ? "preview" : "sent";

  return Response.json(
    {},
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Polaris-Email-Preview": sender.preview ? "1" : "0",
      },
    }
  );
}

export function createEmailHandler(deps: Dependencies) {
  const validator = deps.validator ?? unavailableValidator;

  return async (request: Request, event: WideEvent = {}): Promise<Response> => {
    const blocked = (await botGate(deps.checkBot, request, event)) ?? requestGate(request, event);

    if (blocked) return blocked;

    let submission;

    try {
      submission = await readSubmission(request);
    } catch {
      event.rejection = "unreadable_body";

      return reply(400, "Enter a valid email address.");
    }

    if (submission.website !== "") {
      event.rejection = "honeypot";

      return reply(200, "Check your inbox for the Mac download.");
    }

    if (!validEmail(submission.email)) {
      event.rejection = "invalid_syntax";

      return reply(400, "Enter a valid email address.");
    }

    const retryAfter = deps.rateLimit(request.headers);

    if (retryAfter) {
      event.rejection = "rate_limited";

      return reply(429, "Too many requests. Try again in 15 minutes.", {
        "Retry-After": String(retryAfter),
      });
    }

    deps.requested?.();

    return deliver(deps, validator, submission.email, event);
  };
}
