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
