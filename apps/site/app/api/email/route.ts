import { withWideEvent } from "../../../lib/log";
import { createEmailHandler } from "./_lib";
import { checkEmailBot } from "./_lib/bot";
import { createAdmission, memoryStore, readLimitSecret, readSharedStore } from "./_lib/limiter";
import { sesConfigProblems } from "./_lib/ses";
import { createTransport, previewOnly } from "./_lib/transport";
import { createValidator } from "./_lib/validator";

export const runtime = "nodejs";

const shared = readSharedStore(process.env);

const admission = createAdmission({
  ...(shared ?? { store: memoryStore(), secret: readLimitSecret(process.env) }),
  vercel: process.env.VERCEL === "1",
});

const handler = createEmailHandler({
  checkBot: checkEmailBot,
  validator: {
    validate: (email, report) => createValidator(process.env).validate(email, report),
  },
  transport: () => createTransport(process.env),
  ...admission,
  limiter: shared ? "shared" : "local",
  preview: previewOnly(process.env),
  configProblems: () => sesConfigProblems(process.env),
});

export const POST = withWideEvent("/api/email", (request, event, _context, background) =>
  handler(request, event, background)
);
