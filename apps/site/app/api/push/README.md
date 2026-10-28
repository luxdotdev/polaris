# Push (`POST /api/push`)

The Polaris Relay asks this route to deliver one notification to a Linked Device (ADR 0080;
the relay side is `apps/relay/README.md`, Push). The route holds no content: the body is the
device's APNs token, its APNs environment and a payload sealed to the device with HPKE, which
only the app's Notification Service Extension opens.

## Requests

`POST` with JSON `{ token, environment, payload }` (`PushRequest` in `@polaris/protocol/relay`)
and `x-polaris-timestamp`, `x-polaris-nonce`, `x-polaris-signature`. The route refuses (401,
nothing sent) when:

- the timestamp is more than 60 s from its clock (`stale`);
- the signature isn't HMAC-SHA256 under `POLARIS_PUSH_SECRET` over
  `"polaris-push/1" \n method \n path \n timestamp \n nonce \n hex(SHA-256(body))`
  (`bad_signature`; WebCrypto's `verify` compares in constant time);
- the nonce was already used within 120 s (`replayed`: `SET NX` in the store, only after the
  signature checked out).

It answers `{ outcome }` with: `sent` 200, `unregistered` 410 (APNs `410`, `BadDeviceToken`,
`DeviceTokenNotForTopic`), `rate-limited` 429, `refused` 400 (a bad body, a production token
on a preview deployment, any other APNs 4xx), `unavailable` 503 (no secret, the store or APNs
failing).

## Environments

| Vercel environment | KMS issuer | Apple key | Delivers to |
|---|---|---|---|
| Production | `polaris-apns` `f94308cb-b4b8-4b04-8151-5d9e92fa29cc` | `5L5G3J789G` (Sandbox & Production) | each token's own endpoint: `sandbox` → `api.sandbox.push.apple.com`, `production` → `api.push.apple.com` |
| Preview (and anything not Production) | `polaris-apns-preview` `8128e8cf-6ba4-49b0-a44b-2e935b6a01ad` | `NU22YH4SRB` (Sandbox only) | `api.sandbox.push.apple.com` only; production tokens are refused before signing |

Team `HWD6374DUX`, topic `dev.lux.polaris.mobile`. The app reports its environment when it
registers: development builds `sandbox`; TestFlight and App Store `production`. The issuer
IDs, key IDs and team aren't secret, so they're in `_lib/environment.ts`, not env variables.
Each issuer's policy grants only its own Vercel environment, so a preview deployment can't sign
with the production key even by mistake.

## Provider tokens

`signJWT({ issuerId, claims: { iss: team }, headers: { kid }, ttl: 3600 })` (Vercel KMS; the
imported key's ID is Apple's, so `kid` matches). One token per issuer is kept in the store
(`polaris:push:token:<issuerId>`) and in each instance's memory, and replaced after 55 minutes:
APNs refuses tokens over an hour old and answers `TooManyProviderTokenUpdates` to tokens
replaced more often than every 20 minutes. One instance signs under a 10 s lock while the
others wait up to 3 s for its token. An `ExpiredProviderToken` or `InvalidProviderToken` drops
that token (not a newer one) and retries once. The token is never logged or returned.

APNs is reached over `node:http2`, one session per endpoint per instance, kept open between
requests (`unref`'d). Each notification is an alert with `mutable-content: 1`, a generic
fallback ("Polaris" / "Open Polaris to see what changed.") and the sealed payload under `p`;
`apns-expiration` is an hour.

## Configuration

| Variable | Environments | Value |
|---|---|---|
| `POLARIS_PUSH_SECRET` | Production, Preview (different values) | The secret the relay signs with: `openssl rand -base64 32`. The relay for that environment sets the same value as `POLARIS_RELAY_PUSH_SECRET`. Without it the route sends nothing. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Production, Preview | The Upstash store `/api/email` uses (or `UPSTASH_REDIS_REST_*`). Without it nonces and tokens are per instance: replays across instances aren't caught, and each instance signs its own token. |
| `AXIOM_TOKEN`, `AXIOM_DATASET` | optional | Wide events, as for the other routes. |

KMS needs no variables: the Function authenticates with its OIDC token, and the issuers'
policies grant the `polaris` project per environment.

## Logging

One wide event per request (`lib/log`): `deployment_kind`, `push_store`, `environment`,
`push_outcome`, `rejection`, `apns_status`, `apns_reason` (Apple's reason code),
`token_source` (`memory`/`store`/`signed`), `token_retried`, `failure` (an error's type). Never
the device token, the payload, the provider token or any header.

## Tests

`bun test app/api/push`: signatures, staleness and replays; preview refusing production
tokens; production routing each environment to its endpoint; APNs replies to outcomes; the
expired-token retry; shared token signing across instances; and the HTTP/2 sender against a
local h2c server.
