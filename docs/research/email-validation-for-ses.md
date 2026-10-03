# Email validation before an SES download email

Research snapshot: **2026-10-02**. Task: `email-validation-research`; consumer: `site-email`. Research only; the user chooses the provider. Prices are USD before tax. No live validator credentials, visitor addresses, paid checks, or SES sends were used.

## Recommendation

**Choose Bouncer's Single Email API, subject to confirming its API log and anonymized-data retention in writing.** Its API-specific FAQ says it does not save submitted addresses in a non-anonymized form; its DPA places processing in AWS Frankfurt. This is the clearest published privacy fit for a one-shot download email. The minimum purchase is $8 for 1,000 non-expiring credits, with 100 initial free checks. Use direct HTTP rather than adding an SDK. [Bouncer FAQ][b-faq], [DPA][b-dpa], [pricing][b-price].

**AWS-only alternative: SES `GetEmailAddressInsights`.** AWS launched actual recipient validation on December 18, 2025, including an API usable before a send. At $0.01/check it costs $1/$10/$30 for 100/1,000/3,000 checks, without a credit purchase. Existing AWS IAM and billing are advantages; missing published address-retention and latency guarantees, conservative API throttling, and no explicit catch-all/typo fields are disadvantages. Do not claim it is a zero-retention service. [Launch][aws-launch], [API][aws-api], [pricing][aws-price].

Recommended policy: **BotID → syntax → validator → SES; fail closed**, allow verified role addresses, and withhold mail for catch-all or unknown results. Give the visitor a direct-download/share-link alternative. This deliberately favors reputation over email coverage; it is our proposed policy, not a vendor mandate. A validator estimates deliverability; it does not prove ownership or consent and cannot prevent complaints when an attacker types someone else's valid address.

Do not buy Mailgun's deliverability suite solely for this route. Emailable has good API controls but retains single-check results. ZeroBounce's caching/logging settings need closer review. NeverBounce, Kickbox and Abstract require the privacy/pricing confirmations below. Reoon is a budget challenger, but its fast mode skips mailbox verification and its deep mode can take over a minute. These rankings reflect this route's constraints, not an independent accuracy contest.

## What “we must not store addresses” requires

Keep an address in request memory only: no application database, queue, cache, analytics property, Axiom event, trace attribute, request/response-body logging, or persistent address hash. Do not return the validator's echoed address or enrichment data. Disable client form-value capture and server HTTP instrumentation that records validation URLs; GET APIs can put addresses and sometimes keys in query strings. Use POST and header authentication where documented. These are implementation requirements proposed by this research.

Provider retention is a separate question. GDPR compliance, encryption, hashing and “we do not sell” do **not** establish immediate deletion. Bouncer's FAQ distinguishes single checks from bulk uploads, while its broader DPA permits logs and up to 60 days of result storage. Get confirmation that the single endpoint excludes identifiable addresses from logs, backups and caches, and define whether retained anonymized derivatives are acceptable. [FAQ][b-faq], [DPA][b-dpa].

SES itself stores addresses on its account suppression list until removed. Therefore “no Polaris address database” and “no processor may retain any address” produce different designs. This report does not authorize an exception: the user must resolve whether SES's reputation/suppression records are allowed. If the requirement covers every processor with no exceptions, none of the candidates is fully proven compliant by the public material reviewed. [SES suppression][aws-suppression].

## AWS-native options and SES behavior

### A real pre-send API now exists

`GetEmailAddressInsights` is SES API v2: signed `POST /v2/email/email-address-insights/`, body `{ "EmailAddress": "…" }`, IAM action `ses:GetEmailAddressInsights`. It returns `MailboxValidation.IsValid.ConfidenceVerdict` and evaluations of valid syntax, DNS records, mailbox existence, disposable domain, role address and random input. Verdicts are `HIGH`, `MEDIUM`, `LOW`: `HIGH` on `IsDisposable` means strong evidence of disposability, not safety. Catch-all and typo suggestions are not explicit response fields; the documentation promises mailbox checking without sending a message, not a particular SMTP technique. [API reference][aws-api], [interpretation][aws-guide].

The launch states availability in all SES Regions. EU SES endpoints exist; use the selected SES Region and verify availability in the actual account. The API documents HTTP 400 for bad input and 429 for throttling. The general SES quota page lists non-send API actions at **one request/second**, without a specific Insights exception; plan conservatively and confirm the operation's actual quota before a bursty form launch. No numerical single-check p95/p99 latency or contractual accuracy figure was found. [Launch][aws-launch], [quotas][aws-quotas].

The official AWS SDK for JavaScript v3 is [Apache-2.0][aws-sdk]. Use it for SigV4 rather than borrowing signing code; confirm the installed SES client includes this operation before implementation.

AWS's general content commitments cover regional storage, no marketing/advertising use and restricted disclosure; AWS supplies a GDPR DPA. Those are useful safeguards, but neither the validation API nor its dashboard documentation specifies address-cache/log retention. Inspect CloudTrail behavior as well: SES API calls can be logged, including request parameters; do not assume validation calls omit the address without a synthetic-account readback. [Privacy commitments][aws-privacy], [GDPR][aws-gdpr], [CloudTrail][aws-cloudtrail], [validation dashboard][aws-dashboard].

### Auto Validation complements, rather than replaces, a form verdict

SES Auto Validation runs during attempted sending, at account or configuration-set level. It offers SES-managed, High, or Medium thresholds; High sends only to high-confidence recipients and may suppress legitimate ones. It does not give the route the same pre-send decision as calling Insights. Enable it only through a dedicated download-email configuration set after the user settles provider/privacy policy. [Auto Validation][aws-auto].

À-la-carte API checks cost **$0.01 each**; Auto Validation costs **$0.01 per 1,000**, so 100/1,000/3,000 automatic validations add $0.001/$0.01/$0.03, excluding sending. Suppressed automatic sends still incur sending charges and consume quota. New account/Region combinations can default to Essentials under the July 2026 pricing change; Pro is $105/account/Region/month and includes 2,500 API checks, Enterprise $500 with 5,000. Do not upgrade for this small workload; verify the account's actual plan and add-on rate. No dedicated recurring free API-validation allowance was verified for the inexpensive plans; general AWS promotional credits are not such an allowance. [Current pricing][aws-price].

AWS's walkthrough documents Auto Validation events as permanent bounces with subtype `EmailValidationSuppressed`. It does not explicitly settle whether those events are excluded from `Reputation.BounceRate`; do not extend the account-suppression exclusion to this subtype without AWS confirmation. Track validation suppressions separately from recipient-server bounces. [AWS walkthrough][aws-blog].

### Thresholds and suppression

AWS recommends a bounce rate below **2%**; **5%** triggers review and **10%** may pause sending. Keep complaints below **0.1%**; **0.1%** triggers review and **0.5%** may pause sending. These are enforcement thresholds, not safe budgets. AWS uses a sender-specific representative volume, not a fixed calendar window; complaints use only domains that supply feedback. Only hard bounces contribute to the reputation bounce rate. A small route should investigate every actual bounce/complaint rather than try to reproduce AWS's denominator. [Enforcement FAQ][aws-enforcement], [deliverability][aws-deliverability].

Account suppression is scoped to account/Region and configured reasons (`BOUNCE`, `COMPLAINT`). With matching reasons, SES can accept a send without delivering; it consumes quota but is excluded from the two reputation-rate metrics, while appearing in raw Bounce/Complaint metrics. Only hard bounces auto-add; Gmail complaints are not supplied. Entries persist until removed, except deletion after 90 days of paused sending. A global-only entry does not reliably prevent an attempted send, and an actual bounce still counts. Check configuration-set overrides and both reasons; do not remove a complaint entry because a validator reports deliverable. [Account suppression behavior][aws-suppression].

Sender identity verification is proof of control, not recipient hygiene. SES production access is still required to send to arbitrary visitors: sandbox sending is limited to verified recipients (or simulator addresses), 200 recipients/day and one send/second. [Identity verification][aws-identities], [sandbox][aws-sandbox], [quotas][aws-quotas].

### Pinpoint / AWS End User Messaging

Do not build on Pinpoint: new customers were closed off May 20, 2025 and support ends October 30, 2026. AWS directs email users to SES. End User Messaging preserves SMS, voice, push, OTP and **phone-number** validation APIs; this is not evidence of an email-validation endpoint there. Pinpoint's email identity verification sends a verification email and proves sender control. The now-available SES validation API is the relevant native answer. [Migration notice][pinpoint], [Pinpoint identities][pinpoint-identities].

## Comparison

“Yes” means documented capability, not independent proof. SMTP/mailbox checks can be defeated by greylisting, anti-enumeration and accept-all servers. “Unverified” means the reviewed primary material did not establish the fact; it does not mean the provider lacks it. Provider-specific details and source links follow.

| Candidate | Syntax / MX or DNS / mailbox | Disposable / role / catch-all | Typo suggestion | Form suitability and main limitation |
|---|---|---|---|---|
| SES Insights | Yes / yes / yes (technique unspecified) | Yes / yes / no explicit field | No explicit field | Synchronous; latency unverified; conservative 1 request/s planning. [Docs][aws-guide] |
| Bouncer Single | Yes / yes / SMTP | Yes / yes / `domain.acceptAll` | No documented output field | Configurable timeout, 10s default/30s maximum; more unknowns than batch. [API][b-api] |
| Emailable | Yes / yes / SMTP (keep enabled) | Yes / yes / opt-in `accept_all=true` | `did_you_mean` | 2–10s wait, 5s default; result may require retry. [API][e-api] |
| Mailgun Validate | Yes / yes / mailbox-provider lookup | Yes / yes / result/reason | `did_you_mean` | Synchronous; numerical latency not verified; existing-delivery-data reuse. [Single API][m-api] |
| Reoon Power | Yes / yes / SMTP | Yes / yes / yes | No documented suggestion | Few seconds to >1 minute; Quick <0.5s skips mailbox/catch-all checks. [API][r-api] |
| ZeroBounce | Yes / yes / SMTP | Yes / yes / yes | `did_you_mean` | Vendor claims 96–98% of domains take 1–5s; default timeout 30s. [API][z-api] |
| NeverBounce | Yes / yes / SMTP | Yes / yes / yes | `suggested_correction` | Vendor recommends ~10s HTTP deadline; some hosts take tens of seconds. [API][n-api], [form guide][n-form] |
| Kickbox | Yes / domain checked (MX separately unverified) / SMTP | Yes / yes / yes | `did_you_mean` | SDK defaults to 6s verification timeout; no measured percentile. [SDK docs][k-sdk] |
| Abstract | Yes / yes / SMTP | Yes / yes / yes | `autocorrect` | Marketing claims <300ms; free-tier MX and rate entitlements conflict. [API][a-api], [product][a-product] |

### Low-volume pricing

The table separates cash commitment from usage value. Calculations use listed packages/rates; they are not checkout quotes. Ignore initial free credits in sustained-volume estimates. Monthly reset is not non-expiring prepaid credit. Account-specific and interactive prices must be checked before purchase.

| Candidate | 100 / 1,000 / 3,000 checks: cash after free trial | Free allowance, minimum and expiry |
|---|---|---|
| SES Insights | $1 / $10 / $30 usage billing | No minimum/prepayment; paid-plan inclusions above. [Pricing][aws-price] |
| Bouncer | $8 / $8 / at most $24 buying three 1K packs | 100 signup credits; minimum 1K=$8; 5K=$35; purchased credits never expire. At 1K-pack rate, 100 checks consume $0.80 of the $8 balance. Unknowns not charged. [Pricing][b-price] |
| Emailable | $38 buys 5K for any of these volumes | 250 signup credits; 5K=$38 PAYG; credits never expire. Monthly 5K=$32.30 (15% discount). Usage value $0.76/$7.60/$22.80 from a PAYG pack. [Pricing][e-price] |
| Mailgun Optimize Pilot | $49 / $49 / about $55 per month | First month free; 2,500 monthly checks, then from $1.20/100; 500 extra adds $6. Starter $99/5K; no PAYG credit expiry promise. Confirm rollover/overage rounding, including during trial. [Pricing][m-price] |
| Reoon | $11.90 buys 10K for any of these volumes | 100 signup credits + up to 20/day free (renew on login; not a pooled 600 monthly quota). Instant credits never expire; $9/month starts at 500/day. Unknowns refunded. Usage value $0.119/$1.19/$3.57 from 10K pack. [Pricing][r-price] |
| ZeroBounce | $39 / $39 / at most $78 buying two 2K packs | Minimum 2K=$39; eligible accounts get 100/month free until purchasing. New accounts' credits expire two years after latest purchase; active ONE prevents expiry. Exact 3K checkout quote unverified. [Pricing][z-price], [free eligibility][z-free], [FAQ][z-faq], [expiry][z-expiry] |
| NeverBounce | Unverified at all three volumes | Pricing/billing pages blocked browser retrieval and returned HTTP 403 to direct retrieval. Minimum, free grant, expiry and unknown billing need a current quote. [Pricing][n-price], [billing][n-billing] |
| Kickbox | Unverified at all three volumes | Pricing page blocked browser retrieval and returned HTTP 403 to direct retrieval. Minimum, free grant, expiry and unknown billing need a current quote. [Pricing][k-price] |
| Abstract | $0 if free entitlement sufficient / budget $19 / budget $19 monthly | 100/month free. FAQ quotes Starter $19 monthly or $17/month billed annually ($204 upfront); monthly card instead shows $17/5K. Confirm checkout and entitlements. Published 3 requests/s conflicts with API docs' free 1/s. Rollover unverified; no PAYG pack found. [Pricing][a-price], [API][a-api] |

### Bouncer

API: `GET https://api.usebouncer.com/v1.1/email/verify?email=…&timeout=…`, `x-api-key` header; results `deliverable`, `risky`, `undeliverable`, `unknown`. Default limit **1,000 requests/minute**; greylisting may supply `retryAfter`. Choose a bounded verification wait and independent transport deadline. The reviewed endpoint page documents GET, so do not invent a POST variant from generated snippets. [API][b-api].

Privacy: EU Frankfurt processing, processor DPA with confidentiality/purpose restrictions, and specific no identifiable single-API storage assertion. The generic 60-day result and activity-log clauses need clarification, including hashes/derivatives, backups and SMTP probes outside the EU. No separate regional endpoint is required by the reviewed API. The DPA does not authorize address resale for unrelated use. [FAQ][b-faq], [DPA][b-dpa], [GDPR page][b-gdpr].

Evidence: vendor claims **99.5%+ accuracy**; no reproducible independent dataset or form-submit p95 was verified. Its API acknowledges more unknowns than batch. Do not use competitor-ranking claims as a benchmark. Typo prevention marketing does not establish a suggestion field. [Catch-all explanation][b-accuracy], [API overview][b-overview]. SDK: none needed; no official JS SDK license was established here. Implement a small original HTTP adapter.

### Emailable

API: `GET/POST https://api.emailable.com/v1/verify`, email parameter/body, preferably `Authorization: Bearer …`. Keep `smtp=true`; set `accept_all=true` explicitly because the default skips that check. Limit **25 requests/second** standard. HTTP **249** means still working, not success; 402 insufficient credits, 429 limit exceeded. Docs allow retrying a slow check for five minutes before another charge, but our route should not persist addresses for background polling. [Authentication][e-auth], [limits][e-limits], [status codes][e-status], [API][e-api].

Privacy: single-result retention can be **3 or 7 days**; batch options are 7/14/30 days. The DPA prohibits selling/sharing client personal data, permits service improvement, and allows erasure within 90 days after termination/request. US processor and transfer mechanisms; no EU-only single-check endpoint or zero-retention option verified. The website privacy policy expressly excludes submitted verification addresses, so the DPA is the relevant contract. [Retention][e-retention], [DPA][e-dpa], [privacy policy][e-privacy].

Evidence: deliverability guarantee is **97%+ for Microsoft-managed addresses, 99%+ for others**, with a minimum 1,000 unique opt-in addresses, send within 24h, deliverable classification and limited qualifying bounce causes. A credit/refund guarantee is not independently measured per-form accuracy. [Guarantee][e-guarantee]. Official Node SDK is [MIT][e-sdk]; direct HTTP avoids an additional dependency and unnecessary enrichment fields.

### Mailgun Validate

API: `GET/POST /v4/address/validate`, HTTP Basic (`api` / private API key), `address` form parameter for POST; US `api.mailgun.net`, EU `api.eu.mailgun.net`. Keep `provider_lookup=true`; false may return `unknown/no_data`. Read `result`, `risk`, `reason` and flags rather than a single boolean. Active-request rate limiting produces **429**, but the numerical concurrency cap and p95 latency were not published in the reviewed docs. Do not infer limits from Mailgun's send API. [Single API][m-api], [EU availability][m-eu], [auth/base URLs][m-auth].

Privacy: EU API is documented, and Sinch has a GDPR DPA and says it does not sell personal data absent explicit consent. Its privacy notice, revised September 29, 2026, lists **30-day** retention of irreversible email-derived identifiers/timestamps/counts from delivery events for validity assessment. That is not proof of the single-validation request's retention window; obtain separate cache/log retention and no-reuse terms. The pricing page explicitly says existing email data enriches Optimize. Do not enable engagement profiling for this route. [Privacy][m-privacy], [DPA][m-dpa], [pricing/data reuse][m-price].

Evidence: product material claims lower bounce rates, but no comparable independently audited per-address accuracy or numeric latency bound was established. [Product][m-product]. Official JS SDK [Apache-2.0][m-sdk]; direct HTTP suffices. Pilot's monthly overhead is difficult to justify beside SES or Bouncer at this volume.

### Reoon (additional budget challenger)

API: `GET https://emailverifier.reoon.com/api/v1/verify`, query `email`, `key`, `mode=power`; default `quick` is unsuitable for mailbox-bounce prevention. Single endpoint guidance allows at most **five concurrent threads** and prohibits bulk-style continuous usage. HTTP/application error taxonomy and a bounded Power timeout were not established; unknowns are not safe. [API][r-api].

Privacy: published bulk data retention is **15 days**, with manual deletion; statistics remain. This does not establish single-API retention. The website privacy policy discusses GDPR rights but does not establish an API DPA, EU-only processing, or a checked-address no-resale commitment. The product advertises geographically distributed verification servers. These gaps and Power latency outweigh its cheap credits here. [Bulk retention][r-retention], [privacy][r-privacy], [product][r-price].

Evidence: vendor claims **99%** accuracy; no independent study or Power p95 verified. SDK: none required; no suitable official permissively licensed JS SDK established. Do not copy the WordPress plugin; use an original HTTP adapter if selected.

### ZeroBounce

API: `GET` or form `POST /v2/validate` (POST added September 3, 2026), `api_key`, `email`; omit optional visitor IP. EU endpoint `https://api-eu.zerobounce.net/v2/validate`. Read status/substatus and flags, not just request success. Timeout 3–60s, default 30; unknowns are uncharged. The page's “not rate limited” wording conflicts with its stated 80K requests/10s (100K for ONE), followed by a one-minute block; invalid-key abuse can block for an hour. Invalid key/exhausted credits may arrive as JSON errors. [API][z-api].

Privacy: cached/stored results are permitted; disable “Help Make ZeroBounce Better.” Uploaded-file retention is 30 days, manually deletable; that does not establish normal single-check retention. Policy prohibits sale/rental for marketing and says EU processing unless US API chosen. EU DPA requires the EU-only endpoint. Subprocessor disclosure permits email-containing Cloudflare error logs for API misuse. Obtain single-check cache/log/backups terms even with caching disabled. [Privacy][z-privacy], [EU DPA][z-dpa], [subprocessors][z-processors].

Evidence: **99.6%** accuracy is a vendor claim, not a verified independent benchmark. [Pricing][z-price]. Official JS SDK [MIT][z-sdk]; direct HTTP suffices. Its documented EU option is attractive, but the higher minimum and retention caveats make Bouncer the better conditional fit.

### NeverBounce

API: `GET https://api.neverbounce.com/v4.2/single/check`, `email`, timeout **in seconds**. Secret `key` can be supplied in query or POST JSON/form. Results are strings `valid`, `invalid`, `disposable`, `catchall`, `unknown`; use flags too. Single checks are allowed for user-triggered actions, not bulk-list iteration. Vendor advice allows catch-all/unknown for signup UX; our proposed SES policy withholds them. [API][n-api], [auth][n-auth], [usage][n-usage], [form guide][n-form].

Privacy: March 2026 DPA/SCCs define a processor, prohibit CPRA sale/sharing of customer data, permit US/other-country processing and retain data as required for services plus legal/audit exceptions. No precise single-API deletion window or EU-only endpoint verified. Confirm consumer visitor coverage because its listed data-subject examples concern business contacts/employees. The main privacy page was inaccessible. [DPA][n-dpa], [privacy][n-privacy].

Evidence: no independent accuracy study or latency percentile verified. Official Node SDK [MIT][n-sdk]; documented errors include authentication, referrer, throttling and general failures. Application throttles are configurable; no universal numeric rate established. Direct HTTP avoids legacy SDK behavior. Pricing and retention gaps prevent a purchase recommendation on this evidence.

### Kickbox

API shape verified from its official MIT SDK: `GET https://api.kickbox.com/v2/verify`, query email/timeout, `Authorization: token …`. This is source-derived; confirm against the current account's API reference before building. [HTTP client][k-http], [auth handler][k-auth], [verification method][k-method].

The SDK documents `deliverable`, `undeliverable`, `risky`, `unknown`, disposable/role/accept-all flags, typo suggestion and quality score. `success=true` means the API request succeeded, not that sending is safe. SMTP timeout/connectivity/error reasons require the uncertainty path; balance/time headers assist aggregate operations. Numerical rate ceiling, independent accuracy and measured p95 are unverified. The official Node SDK is [MIT][k-sdk], but its legacy runtime support is no reason to add it instead of original HTTP.

Privacy and pricing: first-party pricing, single-reference and privacy pages could not be retrieved. API-specific retention, GDPR/DPA, EU residency and no-resale terms remain unverified; bulk-provider claims or obsolete Privacy Shield listings cannot establish these. Do not choose it until these questions and low-volume costs/free allowance/expiry are answered. [Pricing][k-price], [reference][k-api], [privacy][k-privacy].

### AbstractAPI

API: `GET https://emailvalidation.abstractapi.com/v1/`, query `api_key`, `email`; nested flags use `.value`, outcome is `DELIVERABLE`, `UNDELIVERABLE`, `UNKNOWN`. Suggestions do not replace the input. Docs say free MX is unavailable/unknown, conflicting with pricing's full-response claims. Pricing also contradicts itself on monthly versus annual Starter prices; use the table's conservative budget until checkout confirms. Each submitted address costs a credit even if invalid; errors include 401, 422 quota, 429 and 5xx. No configurable checking timeout verified. [API][a-api], [pricing][a-price].

Privacy: public GDPR DPA limits processing to instructions, permits US transfers under SCCs and deletion within ten business days after services cease. That is not a per-check deletion deadline. General privacy terms retain data as needed and prohibit selling personal information to marketers; API caches/logs, broader no-resale terms and a selectable EU endpoint remain unverified. Terms permit automatic plan upgrades for volume/repeated rate overages. [DPA][a-dpa], [terms/privacy][a-privacy].

Evidence: **<300ms** is marketing without a percentile/methodology, and no reproducible independent accuracy evidence was found. [Product][a-product]. New Email Reputation has a different schema and additional enrichment; confirm Starter entitlements and endpoint rather than mixing responses. [Reputation API][a-reputation]. No SDK is proposed or needed; use original HTTP. Low monthly pricing does not resolve retention or free-tier capability uncertainty.

## Route contract and proposed decisions

The `site-email` peer reported this implementation seam on 2026-10-02 at its submitted Claim head `32985b81468839c6ff1d93cd469555b265ab79d9`, with 53 site tests passing and a pass-through default. This is **peer-reported**, not code verified or accepted in this research checkout:

`apps/site/app/api/email/_lib/validator.ts`: `EmailValidator.validate(email): Promise<boolean>`; `true` → SES, `false` → 422, rejected promise → generic 503. Dependency injection is in `_lib/index.ts`; tested order is BotID → syntax/honeypot → rate limiting → validator → SES. Keep that order: reject bot traffic and bad syntax before paying for a check.

| Normalized outcome | Route action | Reason |
|---|---|---|
| Confirmed deliverable, non-disposable, non-catch-all, usable mailbox | `true`, then SES once | Positive evidence with no disqualifier |
| Confirmed invalid syntax/domain/nonexistent/disabled mailbox; disposable | `false` → 422; no SES | Address cannot be used under proposed policy |
| Role address with positive mailbox result | Allow if every other acceptance condition passes | Shared inbox is legitimate for a requested download |
| Catch-all / accept-all | Withhold; reject promise → 503/fallback | An accepting server does not prove this mailbox exists |
| Unknown, greylisted, timeout, full mailbox or uncertain risk | Reject promise → 503/fallback | Do not label temporary uncertainty permanently invalid |
| 401/402/429/5xx, transport error, malformed JSON, missing/unrecognized fields | Reject promise → 503/fallback; operational alert without PII | Availability/contract failures must not enable unvalidated sending |
| Typo suggestion | Ask visitor to edit/resubmit; never silently replace recipient | A suggestion is not authorization to email a different person |

This fail-closed behavior applies to **every candidate**. Fail open would turn a validator outage, depleted credits or deliberate throttling into a bounce-risk bypass. The download is public, so a direct link remains a useful fallback. Avoid persistent retry queues and avoid retrying SES after an ambiguous send outcome; those are separate delivery/idempotency design decisions.

Proposed adapter budget: one validation call per accepted submission, **5s verification wait where supported, 6s transport deadline**, and no retry inside the submission. These numbers are design defaults, not measured latency. Record aggregate duration buckets/outcome counters without address/domain/key/body. A shorter timeout improves UX but increases unknowns. Test from the selected Vercel Region with synthetic/owned inboxes before launch; do not equate a function's maximum duration with an acceptable form wait.

For Bouncer, treat `domain.disposable`, `domain.acceptAll`, `account.disabled` and `account.fullMailbox` as tri-state strings: only known `no` clears a risk; missing/`unknown` is uncertainty. Require `status=deliverable`; role alone does not disqualify. Resolve vendor risk reasons before mapping `risky` to anything else. For AWS-only, accept overall `HIGH` with positive syntax/DNS/mailbox verdicts and `IsDisposable=LOW`; overall `MEDIUM` or ambiguous fields withhold, `LOW` validity rejects. Do not confuse high confidence in a bad characteristic with approval. These conservative rules are our proposal based on the [Bouncer output][b-api] and [AWS semantics][aws-guide].

SES success means acceptance, not confirmed delivery. Keep a dedicated configuration set, aggregate delivery/bounce/complaint monitoring, and account suppression for both reasons if the user allows its retention. Do not expose suppression membership in a public response. Do not add unsolicited marketing or tracking to the requested download email. The validator cannot substitute for BotID, abuse rate limits, sender authentication or recipient intent.

## Selection and follow-up questions

The user chooses Bouncer, SES-only, or another provider after reviewing this report. No credentials were provisioned or purchases made. Before implementing the selected adapter:

1. Confirm the meaning of no-storage, especially SES suppression entries and anonymized vendor derivatives. Obtain endpoint-specific retention/log/backups/no-resale terms and a DPA; Bouncer needs its single-API FAQ reconciled with the generic DPA.
2. Confirm selected account checkout price, credits expiry/refund rules, EU processing and burst quota. Do not rely on a stale bulk-list price or an unverified free tier.
3. Run a small consented, owned-inbox evaluation covering valid/invalid, plus aliases, privacy relay addresses, disposable, role, catch-all, slow/greylisted and outages. Measure latency and uncertainty/false rejection separately; keep only aggregate results.
4. Implement against the peer's boolean seam; prove no SES call on unknown/error, no persistence or PII telemetry, and no accidental truthiness of tri-state fields. Provider test keys/fakes verify mapping, not real deliverability.
5. Have AWS confirm the `EmailValidationSuppressed` reputation-metric treatment if Auto Validation is enabled. Resolve provider-specific open gaps below before choosing a candidate with insufficient public evidence.

## Sources and evidence limits

Sources below are first-party docs, current pricing pages, policies and vendor-owned SDK repositories reviewed or attempted on 2026-10-02; inaccessible pages are identified above. Context7 was used first for API discovery; official pages were used to resolve conflicts (generated snippets can invent method/path details). Emailable and Kickbox had no relevant Context7 match, so official docs/SDKs were the fallback. Vendor marketing accuracy and response-time numbers are claims; none was benchmarked by this task. Bulk retention was never assumed to apply to single checks.

[aws-launch]: https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-ses-email-validation/
[aws-api]: https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailAddressInsights.html
[aws-guide]: https://docs.aws.amazon.com/ses/latest/dg/email-validation-api.html
[aws-price]: https://aws.amazon.com/ses/pricing/
[aws-quotas]: https://docs.aws.amazon.com/ses/latest/dg/quotas.html
[aws-auto]: https://docs.aws.amazon.com/ses/latest/dg/email-validation-auto.html
[aws-blog]: https://aws.amazon.com/blogs/messaging-and-targeting/how-to-improve-email-sender-reputation-with-amazon-ses-email-validation/
[aws-enforcement]: https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html
[aws-deliverability]: https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-deliverability.html
[aws-suppression]: https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html
[aws-identities]: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html
[aws-sandbox]: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
[aws-privacy]: https://aws.amazon.com/compliance/data-privacy-faq/
[aws-gdpr]: https://aws.amazon.com/compliance/gdpr-center/
[aws-cloudtrail]: https://docs.aws.amazon.com/ses/latest/dg/logging-using-cloudtrail.html
[aws-dashboard]: https://docs.aws.amazon.com/ses/latest/dg/email-validation-dashboard.html
[aws-sdk]: https://github.com/aws/aws-sdk-js-v3/blob/main/LICENSE
[pinpoint]: https://docs.aws.amazon.com/pinpoint/latest/userguide/migrate.html
[pinpoint-identities]: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-email-manage-verify.html
[b-api]: https://docs.usebouncer.com/api-reference/real-time/verify-email
[b-overview]: https://www.usebouncer.com/email-verification-api/
[b-faq]: https://www.usebouncer.com/faq/
[b-dpa]: https://www.usebouncer.com/dpa/
[b-gdpr]: https://www.usebouncer.com/gdpr/
[b-price]: https://www.usebouncer.com/pricing/
[b-accuracy]: https://www.usebouncer.com/catch-all-email-verification/
[e-api]: https://emailable.com/docs/api/emails/
[e-auth]: https://emailable.com/docs/api/authentication/
[e-limits]: https://emailable.com/docs/api/rate-limits/
[e-status]: https://emailable.com/docs/api/status-codes/
[e-price]: https://emailable.com/pricing/
[e-retention]: https://emailable.com/docs/manage-your-account/account/data-retention/
[e-dpa]: https://emailable.com/data-processing-agreement/
[e-privacy]: https://emailable.com/privacy-policy/
[e-guarantee]: https://emailable.com/guarantee/
[e-sdk]: https://github.com/emailable/emailable-node
[m-api]: https://documentation.mailgun.com/docs/validate/single-valid-ir
[m-auth]: https://documentation.mailgun.com/docs/validate/api-overview
[m-eu]: https://documentation.mailgun.com/docs/validate/email-valid-ir
[m-price]: https://www.mailgun.com/pricing/optimize/
[m-product]: https://www.mailgun.com/products/validate/
[m-privacy]: https://www.mailgun.com/legal/privacy-policy/
[m-dpa]: https://sinch.com/legal/terms-and-conditions/other-sinch-terms-conditions/data-processing-agreement/
[m-sdk]: https://github.com/mailgun/mailgun.js
[r-api]: https://www.reoon.com/articles/api-documentation-of-reoon-email-verifier/
[r-price]: https://www.reoon.com/email-verifier/
[r-retention]: https://www.reoon.com/articles/verify-bulk-email-list-dashboard/
[r-privacy]: https://www.reoon.com/privacy-policy/
[z-api]: https://zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
[z-price]: https://www.zerobounce.net/pricing
[z-free]: https://www.zerobounce.net/security
[z-faq]: https://zerobounce.net/docs
[z-expiry]: https://zerobounce.net/docs/frequently-asked-questions/questions-about-our-services/do-email-validation-credits-expire
[z-privacy]: https://www.zerobounce.net/privacy-policy
[z-dpa]: https://www.zerobounce.net/docs/assets_next_docs/docs/assets/zb_data_processing_agreement-18-08-25_EU.pdf
[z-processors]: https://zerobounce.net/docs/about-zerobounce
[z-sdk]: https://github.com/zerobounce/zero-bounce-javascript
[n-api]: https://developers.neverbounce.com/reference/single-check
[n-auth]: https://developers.neverbounce.com/reference/authentication
[n-form]: https://developers.neverbounce.com/docs/verifying-an-email
[n-usage]: https://developers.neverbounce.com/reference/usage-guidelines
[n-sdk]: https://github.com/neverbounce/neverbounceapi-nodejs
[n-price]: https://neverbounce.com/pricing
[n-billing]: https://neverbounce.com/help/how-does-pricing-and-billing-work
[n-privacy]: https://neverbounce.com/privacy-policy
[n-dpa]: https://storage.googleapis.com/cws-neverbounce-assets.zoominfo.com/Never_Bounce_C2_P_SC_Cs_w_UK_Addendum_03_2026_1_fea3cada8c/Never_Bounce_C2_P_SC_Cs_w_UK_Addendum_03_2026_1_fea3cada8c.pdf
[k-sdk]: https://github.com/kickboxio/kickbox-node
[k-http]: https://github.com/kickboxio/kickbox-node/blob/master/lib/kickbox/http_client/index.js
[k-auth]: https://github.com/kickboxio/kickbox-node/blob/master/lib/kickbox/http_client/auth_handler.js
[k-method]: https://github.com/kickboxio/kickbox-node/blob/master/lib/kickbox/api/kickbox.js
[k-api]: https://docs.kickbox.com/docs/single-verification-api
[k-price]: https://www.kickbox.com/pricing
[k-privacy]: https://docs.kickbox.com/docs/privacy-policy
[a-api]: https://docs.abstractapi.com/api/email-validation
[a-product]: https://www.abstractapi.com/api/email-verification-validation-api
[a-price]: https://www.abstractapi.com/pricing
[a-dpa]: https://www.abstractapi.com/legal/dpa
[a-privacy]: https://www.abstractapi.com/legal/legal
[a-reputation]: https://docs.abstractapi.com/api/email-reputation
