# Mac download email

`POST /api/email` accepts JSON `{ "email": "you@example.com", "website": "" }`.
BotID checks run first and reject both `isBot` and `isVerifiedBot` (including
good bots), before reading the body. Missing client protection or detection
failure fails closed. The hidden `website` field is a honeypot. The route sends one plain-text email
with the canonical `/download/mac` and GitHub source links; no attachment,
subscription, tracking pixel or recipient list.

Client protection is initialized in `instrumentation-client.ts` using
`initBotId({ protect: [{ path: "/api/email", method: "POST" }] })`;
`withBotId` configures its proxy rewrites. Production must be deployed on
Vercel with BotID and OIDC enabled. The SDK development HUMAN bypass applies
only outside production and is tested alongside BAD-BOT and GOOD-BOT.
BotID processes browser signals and request headers through Vercel; Polaris
does not persist or log those inputs or the verdict.

An injectable `EmailValidator.validate(email): Promise<boolean>` follows
syntax/honeypot/rate checks and precedes SES. `true` permits sending, `false`
returns 422, and an exception returns generic 503 without sending. The default
is pass-through: a separate research task is choosing the provider. This
default does not check mailbox existence or deliverability.

## Configuration

Set server-only environment variables on the production deployment:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | The SES region with the verified sender identity |
| `POLARIS_EMAIL_FROM` | A verified sender email address (address only) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credentials permitted to call `ses:SendEmail` for that identity |
| `AWS_SESSION_TOKEN` | Session token, if using temporary credentials |
| `POLARIS_EMAIL_USE_ROLE` | `true` to opt into the SDK's default credential chain for a hosted role instead of static credentials |
| `AXIOM_TOKEN`, `AXIOM_DATASET` | Optional, shared with the update/download routes |

No public env variables, credentials in code, AWS config lookups for region or
sender, or automatic fallback to a mail app. Role mode relies on the hosting
environment's credential provider (for example container credentials or web
identity via `AWS_ROLE_ARN` / `AWS_WEB_IDENTITY_TOKEN_FILE`); grant only send
permission for the sender. Credentials are resolved by the SDK at send time.
Missing region, sender, credential pair or role opt-in returns 503; resolution
or SES errors also return a generic 503 and discard provider details.

Development and tests always use a fake transport, even with AWS credentials
present. The response header `X-Polaris-Email-Preview: 1` makes the form say
"Preview only. No email was sent." Production refuses
`POLARIS_EMAIL_TRANSPORT=fake` rather than pretending to send. Real delivery
requires SES sender verification and production access (sandbox accounts can
only send to verified recipients). No live email or production BotID classification was used in the tests.

## Privacy and abuse limits

The address lives only in the submitted form, the request and the SES call;
the form clears it after success. There is no database, queue, persistent
storage, console logging, SDK logger, or raw error reporting. SES necessarily
processes the recipient to deliver the message. This code does not configure
SES delivery-event logging or host access logs.

The only Axiom event is `{ event: "email_requested", route: "/api/email",
_time: "..." }` for a valid, non-honeypot, rate-admitted submission. It receives
no request data: no email, IP, IP digest, headers, user agent or provider error.
Ingest runs via Next's `after()`, once, without retries; absent config and
ingest failures are silent and do not affect sending.

Validation accepts plain ASCII addresses with a dotted domain, caps addresses
at 254 characters (64 for the local part), and rejects display names, empty
labels and control characters. The JSON body has a streamed 2 KiB limit even
without a Content-Length header. Browser requests must use JSON and the same
Origin as the route. Honeypot submissions return an innocuous 200 without
sending or telemetry.

The in-memory guard allows three attempts per IP in a 15-minute fixed window
and at most 100 attempts per instance per window. Syntax-valid, non-honeypot attempts count before the validator or sending,
including failed sends. `Retry-After` is returned with
429. Only on Vercel (`VERCEL=1`) is its protected `x-vercel-forwarded-for`
header trusted; elsewhere, or with a missing/invalid header, all requests share
one fallback bucket. IPv6 spellings are canonicalized. Raw IPs are used only to
compute an HMAC with a random per-window secret; only digests and counts are
kept (at most 100 entries), never logged. Expired state and its secret are
replaced on the next request; there are no timers or persistent IP records.

This guard avoids retaining personal data in a distributed store, but its
limit resets on cold start, is per instance, and permits bursts across window
boundaries. Configure a Vercel Firewall rule for `/api/email` before a high
traffic launch if a deployment-wide limit is needed. This is not a promise of
deployment-wide abuse protection.

Docs: [BotID setup](https://vercel.com/docs/botid/get-started),
[BotID development](https://vercel.com/docs/botid/local-development-behavior),
[SESv2 SendEmail](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/command/SendEmailCommand/),
[credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html),
[Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).
