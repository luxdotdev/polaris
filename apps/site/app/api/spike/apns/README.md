# Spike: APNs provider tokens from Vercel KMS (ENG-461)

Throwaway, not product code ([ADR 0080](../../../../../../docs/adr/0080-linked-devices-reach-hosts-through-the-polaris-relay.md)).
`POST /api/spike/apns` signs an APNs provider token with a KMS issuer that holds the imported
Apple `.p8`, and sends one alert push to the APNs sandbox over `node:http2`.

- **404** in production, and without the `x-spike-secret` header (only its SHA-256 is in the code).
- Body: `{ issuerId, teamId, keyId, topic, deviceToken, mode }`. None of these are secret.
- `mode: "message"` builds `{"alg":"ES256","kid":<Apple key ID>}.{"iss":<team>,"iat":…}` and
  signs it with `signMessage`, converting DER to the raw `r||s` JWS needs if KMS returns DER.
- `mode: "jwt"` calls `signJWT` with `kid` in `headers` and `iss` in `claims`; KMS adds
  `iat`/`nbf`/`exp`, and the response shows the header and claims KMS actually produced.
- Tokens are cached per mode in the Function instance for 55 minutes; the response says
  whether the token was cached, how long signing took and how long APNs took.

## Dashboard steps (the user)

1. Team settings → Key Management → Create issuer: name `polaris-apns-spike`, algorithm
   `ES256`, origin **external**, import the Apple `.p8` (PKCS#8 PEM, as Apple ships it), key ID
   (`importKeyId`) = Apple's 10-character key ID, so KMS's `kid` is Apple's.
2. Add a `project-grant` policy: project `polaris` (root `apps/site`), environment
   **Preview** only.
3. Give the Lead the issuer ID, the Apple Team ID and the key ID.

## Proof without a device

APNs authenticates the provider token before it looks at the device token. With a dummy
64-hex token, **400 `BadDeviceToken`** means the KMS-signed JWT was accepted, while **403
`InvalidProviderToken`** means it was not. Real delivery is proven in R5 with the Mobile App.

## Results (2026-10-27, preview `c8ffef1`, region iad1)

Issuer `polaris-apns-spike`: ES256, external origin, one active key, project-grant for `polaris`
Preview. The imported key ID became the JWKS and JWT `kid` (`NU22YH4SRB`), so no override is needed.

| Mode | KMS sign (fresh) | APNs round trip | APNs answer |
|---|---|---|---|
| `signMessage` | 142 ms (first call, cold) | 222 ms, 207 ms cached | 400 `BadDeviceToken` |
| `signJWT` | 53 ms | 222 ms, 206 ms cached | 400 `BadDeviceToken` |

- Control: the same header and claims with an all-zero signature, sent straight to the sandbox,
  get **403 `InvalidProviderToken`**. So the 400s mean APNs accepted both KMS-signed tokens.
- `signMessage` returns the raw 64-byte `r||s` for ES256, not DER: it is a JWS signature as is.
- `signJWT` keeps our `kid` and `iss`, adds `typ: JWT`, `nbf` and `exp` (`ttl` 3600); APNs
  accepts the extra claims.
- APNs time includes a new HTTP/2 connection per push; a kept-open session would cut it.
- One fresh sample per mode (the cache is per instance); treat the latencies as indicative.

**Cost.** ES256 is an "advanced" operation: $0.15 per 10,000, $0.000015 a token. One token per
55 minutes is ~26 a day, ~790 a month per warm instance: about $0.012 a month, inside Hobby's
5,000 free operations.

**Recommendation.** Use `signJWT` with `ttl: 3600`: one call, no JWS assembly, and the fastest
here. Keep the token in a shared store (not per instance) and refresh at 55 minutes, since APNs
answers `TooManyProviderTokenUpdates` when tokens change more often than every 20 minutes.
