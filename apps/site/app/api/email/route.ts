import { withWideEvent } from "../../../lib/log";
import { createEmailHandler } from "./_lib";
import { checkEmailBot } from "./_lib/bot";
import { createRateLimit } from "./_lib/rate-limit";
import { sesConfigProblems } from "./_lib/ses";
import { createTransport } from "./_lib/transport";
import { createValidator } from "./_lib/validator";

export const runtime = "nodejs";

const limit = createRateLimit();

const handler = createEmailHandler({
  checkBot: checkEmailBot,
  validator: {
    validate: (email, report) => createValidator(process.env).validate(email, report),
  },
  transport: () => createTransport(process.env),
  rateLimit: (headers) => limit(headers, process.env.VERCEL === "1"),
  configProblems: () => sesConfigProblems(process.env),
});

export const POST = withWideEvent("/api/email", (request, event) => handler(request, event));
