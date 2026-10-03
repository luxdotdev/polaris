import { after } from "next/server";
import { createEmailHandler } from "./_lib";
import { checkEmailBot } from "./_lib/bot";
import { createRateLimit } from "./_lib/rate-limit";
import { logEmailRequested } from "./_lib/telemetry";
import { createTransport } from "./_lib/transport";
import { createValidator } from "./_lib/validator";

export const runtime = "nodejs";

const limit = createRateLimit();

export const POST = createEmailHandler({
  checkBot: checkEmailBot,
  validator: { validate: (email) => createValidator(process.env).validate(email) },
  transport: () => createTransport(process.env),
  rateLimit: (headers) => limit(headers, process.env.VERCEL === "1"),
  requested: () => after(() => logEmailRequested(process.env)),
});
