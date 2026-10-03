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
returns 422, and an exception returns generic 503 without sending. Production uses AWS SESv2 `GetEmailAddressInsights` in the send Region with the
same credentials. Only overall `IsValid=HIGH`, `HasValidSyntax=HIGH`,
`HasValidDnsRecords=HIGH`, `MailboxExists=HIGH` and `IsDisposable=LOW` allow
sending. Overall LOW returns 422. With overall HIGH, LOW syntax/DNS/mailbox or
HIGH disposability also return 422. MEDIUM overall or any other uncertain
acceptance field returns generic 503; no send occurs. All six evaluation fields
must contain a recognized HIGH/MEDIUM/LOW verdict; missing, malformed or unknown
fields fail closed. Role addresses are allowed; role/random-pattern evaluations
do not override the overall and required deliverability verdicts.

The API supplies no explicit catch-all, typo, full-mailbox or greylisting fields.
We withhold ambiguous mailbox results rather than infer a confirmed mailbox,
and never change a recipient based on a suggestion. The public `/download/mac`
link remains the fallback. Insights cannot prove ownership or guarantee delivery.

Each admitted submission makes at most one validation call, with no retries and
a hard **5-second deadline**, including credential resolution. Deadline expiry
aborts the SDK request and returns 503 even if the client has not settled; a late
success cannot send. HTTP errors (including 400/429), network failures and timeouts
all return generic 503. Provider and schema errors are replaced without a cause;
no address, domain, response, metadata or error is logged or traced. Omitting the
validator dependency fails closed; there is no production pass-through default.

The adapter keeps only process-local aggregate counters (`accepted`, `invalid`,
`uncertain`, `unavailable`). Snapshots contain counts only, no timestamps or
request identifiers. Counters reset on cold start and are not persisted or sent
to Axiom; development/test fake checks do not increment them.

## Configuration

Set server-only environment variables on the production deployment:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | The SES region with the verified sender identity |
| `POLARIS_EMAIL_FROM` | A verified sender email address (address only) |
| `POLARIS_EMAIL_CONFIGURATION_SET` | Required dedicated SES configuration set name, e.g. `polaris-download` |
| `AWS_ROLE_ARN` | The IAM role assumed with Vercel's OIDC token (`arn:aws:iam::<account>:role/<name>`) |
| `AXIOM_TOKEN`, `AXIOM_DATASET` | Optional, shared with the update/download routes |

Credentials come only from the IAM role: `@vercel/oidc-aws-credentials-provider`
exchanges the deployment's OIDC token for short-lived STS credentials. Static
access keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) are
never read, and must not be set (docs/adr/0018). Setup:

1. Vercel: Project → Settings → Security → OIDC federation, issuer mode Team.
2. AWS IAM → Identity providers → OpenID Connect: URL `https://oidc.vercel.com/<team-slug>`,
   audience `https://vercel.com/<team-slug>`.
3. A role trusting that provider for `sts:AssumeRoleWithWebIdentity`, with
   `oidc.vercel.com/<team-slug>:aud` = `https://vercel.com/<team-slug>` and
   `oidc.vercel.com/<team-slug>:sub` = `owner:<team-slug>:project:<project>:environment:production`.
4. Role permissions: `ses:GetEmailAddressInsights` (resource `*`) and `ses:SendEmail`
   scoped to the sender identity and configuration set ARNs.

No public env variables, credentials in code, AWS config lookups for region or
sender, or automatic fallback to a mail app. Credentials are resolved at
validation/send time. Missing region, sender, configuration set or a valid role
ARN returns 503; token exchange or SES errors also return a generic 503 and
discard provider details.

Development and tests always use a fake validator and transport, even with AWS credentials
present. The response header `X-Polaris-Email-Preview: 1` makes the form say
"Preview only. No email was sent." Production refuses
`POLARIS_EMAIL_TRANSPORT=fake` rather than pretending to send. Real delivery
requires SES sender verification and production access (sandbox accounts can
only send to verified recipients). No live email or production BotID classification was used in the tests.

## AWS setup and quota

Grant the runtime identity `ses:GetEmailAddressInsights` on `Resource: "*"`
(the action has no recipient resource scope) and `ses:SendEmail` restricted to
the verified sender identity and dedicated configuration set resources. If AWS
needs a service-linked role for validation metrics, provision it through an
operator with `iam:CreateServiceLinkedRole`; do not broadly grant IAM to the route.

Create `polaris-download` in the same SES Region, set
`POLARIS_EMAIL_CONFIGURATION_SET=polaris-download`, and verify its suppression
options do not weaken account BOUNCE/COMPLAINT suppression. Every SendEmail command
includes that configuration set. No set is created by the app; a missing/nonexistent
set fails closed. Auto Validation is an optional operator defense, not enabled by
this code; confirm how `EmailValidationSuppressed` affects reputation metrics before
enabling it. Do not configure recipient-bearing event publishing for this flow.

Plan conservatively for **1 request/second** for non-send SES APIs until AWS
confirms this operation's account/Region quota. The per-instance form limiter is
not global pacing; concurrent instances can exceed that quota. A throttle returns
503/fallback without validation or send retry. Confirm availability, IAM, price
($0.01/check per the research snapshot) and quota in the actual account before
launch. No live AWS check or delivery has been performed by these tests.

## Privacy and abuse limits

The address lives only in the submitted form, the request and the SES validation/send calls;
the form clears it after success. There is no database, queue, persistent
storage, console logging, SDK logger, or raw error reporting. SES necessarily
processes the recipient to validate and deliver the message. The user explicitly
allows SES account-level suppression entries; Polaris still stores no addresses
and uses no third-party validator. Enable account suppression for both BOUNCE and
COMPLAINT in this Region and retain complaint entries even after a positive
Insights verdict. SES acceptance can still mean suppressed delivery; the public
response does not reveal membership. AWS retention is not a zero-retention promise.

This code does not configure SES delivery-event logging, CloudTrail or host access
logs. Before launch, inspect those AWS/deployment settings with synthetic data;
disable/redact request bodies and recipient-bearing telemetry/traces. Avoid event
destinations that retain addresses; use aggregate SES reputation/bounce/complaint
metrics instead.

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
[SES Insights API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailAddressInsights.html),
[validation verdicts](https://docs.aws.amazon.com/ses/latest/dg/email-validation-api.html),
[SES quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html),
[SES IAM](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html),
[SESv2 SendEmail](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/command/SendEmailCommand/),
[Vercel OIDC for AWS](https://vercel.com/docs/oidc/aws),
[Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).
