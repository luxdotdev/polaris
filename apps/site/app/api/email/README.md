# Mac download email

`POST /api/email` accepts JSON `{ "email": "you@example.com", "website": "" }`.
BotID checks run first and reject both `isBot` and `isVerifiedBot` (including
good bots), before reading the body. Missing client protection or detection
failure fails closed. The hidden `website` field is a honeypot. The route sends one email, the
react-email template in `apps/site/emails/download.tsx` (HTML plus a plain-text part; preview
with `bun run --cwd apps/site email:dev`), with the canonical `/download/mac` and GitHub source links; no attachment,
subscription, tracking pixel or recipient list.

Client protection is initialized in `instrumentation-client.ts` using
`initBotId({ protect: [{ path: "/api/email", method: "POST" }] })`;
`withBotId` configures its proxy rewrites. Production must be deployed on
Vercel with BotID and OIDC enabled. The SDK development HUMAN bypass applies
only outside production and is tested alongside BAD-BOT and GOOD-BOT.
BotID processes browser signals and request headers through Vercel; Polaris
does not persist or log those inputs or the verdict.

## One reply for every address

Every syntax-valid submission, including the honeypot, gets the same `202` with the
same headers and body (`{ "message": "Check your inbox for the Mac download. Not
there? Download it on your Mac at polaris.lux.dev." }`), sent before any limit,
validation or send runs. Admission, validation and delivery then run in the background
(`after()` via `withWideEvent`'s `background`), so neither status, body nor response
time says whether the address was valid, uncertain, rate limited, in its cooldown,
suppressed or sent to. The reason is recorded only on the wide event. Only checks that
don't depend on the address answer differently: BotID (403/503), Origin (403),
content type (415) and an unreadable body or bad syntax (400), which the form can tell
the user to fix. `X-Polaris-Email-Preview` is fixed per deployment (`1` outside production).

An injectable `EmailValidator.validate(email): Promise<boolean>` follows
admission and precedes SES. `true` permits sending; `false` or an exception sends
nothing. Production uses AWS SESv2 `GetEmailAddressInsights` in the send Region with the
same credentials. Sending needs overall `IsValid=HIGH`, `HasValidSyntax=HIGH`,
`HasValidDnsRecords=HIGH`, `IsDisposable=LOW` and `MailboxExists` HIGH or MEDIUM:
Gmail and other large providers block mailbox probing, so a real Gmail address
reads MEDIUM (verified 2026-10-02). Overall LOW, LOW syntax/DNS/mailbox or HIGH
disposability are `invalid`; any other verdict is `uncertain`; neither sends. Each Insights confidence level is recorded on the wide event
(`insights_valid`, `insights_syntax`, `insights_dns`, `insights_mailbox`,
`insights_disposable`, `insights_role`, `insights_random`). All six evaluation fields
must contain a recognized HIGH/MEDIUM/LOW verdict; missing, malformed or unknown
fields fail closed. Role addresses are allowed; role/random-pattern evaluations
do not override the overall and required deliverability verdicts.

The API supplies no explicit catch-all, typo, full-mailbox or greylisting fields.
We withhold ambiguous mailbox results rather than infer a confirmed mailbox,
and never change a recipient based on a suggestion. The public `/download/mac`
link remains the fallback. Insights cannot prove ownership or guarantee delivery.

Each admitted submission makes at most one validation call, with no retries and
a hard **5-second deadline**, including credential resolution. Deadline expiry
aborts the SDK request and records `unavailable` even if the client has not settled; a late
success cannot send. HTTP errors (including 400/429), network failures and timeouts
are all `unavailable`. Provider and schema errors are replaced without a cause;
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
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | The shared limit store (Upstash Redis REST URL and token); `UPSTASH_REDIS_REST_URL`/`_TOKEN` also work. Without them each instance limits only itself |
| `POLARIS_EMAIL_LIMIT_SECRET` | Recommended: at least 32 random bytes keying the limit store's digests, so rotating the store token keeps limits and cooldowns. Without it the key is derived from the store token (or is random per instance locally) |
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
ARN sends nothing and records `email_unconfigured`; token exchange or SES errors
record `send_failed` and discard provider details.

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
confirms this operation's account/Region quota. The shared limiter's deployment-wide
ceiling (450 per 15 minutes, below) keeps the average under half that pace, but it is
not per-second pacing. A throttle is recorded as `unavailable` without validation or send retry. Confirm availability, IAM, price
($0.01/check per the research snapshot) and quota in the actual account before
launch. No live AWS check or delivery has been performed by these tests.

## Privacy and abuse limits

The address lives only in the submitted form, the request and the SES validation/send calls;
the form clears it after the reply. Apart from the limit store's keyed digests (below)
there is no database, queue, persistent storage, console logging, SDK logger, or raw error reporting. SES necessarily
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

Every request emits one wide event (`lib/log`, shared with the release routes):
deployment context, `status_code`, `outcome`, `duration_ms`, and why it ended:
`bot` (`human`/`bot`/`verified_bot`/`unavailable`), `rejection`
(`origin_mismatch`, `content_type`, `unreadable_body`, `honeypot`,
`invalid_syntax`, `source_limited`, `total_limited`, `recipient_cooldown`),
`cooldown_release` (`failed` when a submission that sent nothing couldn't lift its cooldown),
`limiter` (`shared`/`local`), `validation`
(`accepted`/`invalid`/`uncertain`/`unavailable`), `failure`
(`botid_unavailable`, `limiter_unavailable`, `validation_<reason>`, `email_unconfigured` with
`missing_config` variable names, `send_failed`), `error` (error type and HTTP
status only) and `delivery` (`sent`/`preview`). It never carries the email
address, its domain, an IP, headers, the body or any error message. It is sent
to Axiom once via `after()`, after the background work has settled, and written to
the function log with the ingest result; logging never affects sending. Background
failures (`limiter_unavailable`, provider `unavailable`, `email_unconfigured`,
`send_failed`) and `total_limited`, which refuses every visitor, raise the event to
level `error` with `outcome: "error"`, though the public status stays 202; alert on
those, not on `status_code`.

Validation accepts plain ASCII addresses with a dotted domain, caps addresses
at 254 characters (64 for the local part), and rejects display names, empty
labels and control characters. The JSON body has a streamed 2 KiB limit even
without a Content-Length header. Browser requests must use JSON and the same
Origin as the route. Honeypot submissions get the same 202 without sending or
telemetry.

### Admission limits (`_lib/limiter.ts`)

Before any SES call, each syntax-valid submission must pass, in order (a refusal
spends no later budget):

1. **Source** (the primary control): 3 per 15-minute fixed window per IP. Only on
   Vercel (`VERCEL=1`) are forwarding headers trusted, all set by Vercel's edge:
   `x-vercel-forwarded-for`, then `x-real-ip`, then the rightmost hop of
   `x-forwarded-for` (the one the platform appended; earlier hops are client-supplied).
   IPv6 sources are keyed by their /64 and IPv4-mapped IPv6 by its IPv4 address.
   Submissions with no usable source (or off Vercel) share one `unknown` bucket of 30
   per window, so a missing header neither limits every visitor to 3 nor escapes limits.
2. **Deployment ceiling:** 450 per 15-minute window across every instance. It is a
   cost and quota backstop, not the everyday limit: 450 per window is 0.5/second on
   average, half the 1/second planned for `GetEmailAddressInsights`, and 43,200 a day,
   under SES's 50,000-a-day starting production sending quota; at $0.01 per check it
   caps validation spend at $4.50 per window. Real traffic is far below it. Reaching it
   refuses everyone for the rest of the window, so each such event is level `error`
   (`rejection: "total_limited"`) for an Axiom alert.
3. **Recipient cooldown:** one email per mailbox per 10 minutes, whichever source
   asks, to stop repeated mail to one inbox. The mailbox is the address lowercased,
   without a `+tag`, and for Gmail without dots. The cooldown is claimed at admission so
   concurrent submissions can't both send, and released when nothing was sent (invalid,
   uncertain or unavailable validation, missing configuration, a failed send), so a
   failure never blocks the address and only a delivered email holds it.

All three live in a `LimitStore` (`increment` with expiry, `claim` if absent). With
`KV_REST_API_URL`/`KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair) set to an
`https://` Upstash Redis, the route uses it through the REST `/multi-exec` endpoint,
so limits hold across instances and cold starts (`limiter: "shared"`). Any store error
or unexpected reply fails closed: nothing is validated or sent (`limiter_unavailable`).
Keys are `polaris:email:…` HMAC-SHA-256 digests under `POLARIS_EMAIL_LIMIT_SECRET`
(or a key derived from the store token), never a raw address or IP, and expire with
their window or cooldown.

Without that configuration the route falls back to a process-local store
(`limiter: "local"`): the same limits, but per instance and reset on cold start,
so it is not deployment-wide protection. It holds at most 10,000 entries; when full it
drops expired entries, then the least recently used, so a flood of sources can't
refuse everyone (the deployment counter, touched on every admission, stays). Fixed windows permit a
burst across a window boundary in either mode.

**Owner setup:** add an Upstash Redis database to the Vercel project (Vercel
Marketplace → Upstash → Redis, connected to the production environment), which sets
`KV_REST_API_URL` and `KV_REST_API_TOKEN`; redeploy, then confirm wide events show
`limiter: "shared"`. A Vercel Firewall rate-limit rule on `/api/email` is still worth
adding as an edge layer in front.

Docs: [BotID setup](https://vercel.com/docs/botid/get-started),
[BotID development](https://vercel.com/docs/botid/local-development-behavior),
[SES Insights API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailAddressInsights.html),
[validation verdicts](https://docs.aws.amazon.com/ses/latest/dg/email-validation-api.html),
[SES quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html),
[SES IAM](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html),
[SESv2 SendEmail](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/command/SendEmailCommand/),
[Vercel OIDC for AWS](https://vercel.com/docs/oidc/aws),
[Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).
