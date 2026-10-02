import type { EmailTransport } from "./transport";
import type { BotCheck } from "./bot";
import { passThroughValidator, type EmailValidator } from "./validator";
import { readSubmission, validEmail } from "./validation";

type Dependencies = {
  checkBot: BotCheck;
  validator?: EmailValidator;
  transport: () => EmailTransport | null;
  rateLimit: (headers: Headers) => number;
  requested: () => void;
};

function reply(status: number, message: string, headers?: Readonly<Record<string, string>>) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}

export function createEmailHandler({
  checkBot,
  validator = passThroughValidator,
  transport,
  rateLimit,
  requested,
}: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const verification = await checkBot(request);

      if (verification.isBot || verification.isVerifiedBot)
        return reply(403, "This request was blocked. Please try again from your browser.");
    } catch {
      return reply(503, "Email is unavailable. Please try again later.");
    }

    const origin = request.headers.get("origin");
    const publicUrl = new URL(request.url);
    const host = request.headers.get("host");

    // Next can normalize the internal URL to localhost in development; Host is the browser's authority.
    if (host) publicUrl.host = host;

    if (origin && origin !== publicUrl.origin)
      return reply(403, "Send this form from the Polaris site.");

    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return reply(415, "Send the email form as JSON.");
    }

    let submission;

    try {
      submission = await readSubmission(request);
    } catch {
      return reply(400, "Enter a valid email address.");
    }

    if (submission.website !== "") return reply(200, "Check your inbox for the Mac download.");

    if (!validEmail(submission.email)) return reply(400, "Enter a valid email address.");

    const retryAfter = rateLimit(request.headers);

    if (retryAfter)
      return reply(429, "Too many requests. Try again in 15 minutes.", {
        "Retry-After": String(retryAfter),
      });
    requested();

    try {
      if (!(await validator.validate(submission.email)))
        return reply(422, "Use another email address.");
      const sender = transport();

      if (!sender) return reply(503, "Email is not available yet. Please try again later.");
      await sender.send(submission.email);

      return Response.json(
        {},
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Polaris-Email-Preview": sender.preview ? "1" : "0",
          },
        }
      );
    } catch {
      return reply(503, "The email could not be sent. Please try again later.");
    }
  };
}
