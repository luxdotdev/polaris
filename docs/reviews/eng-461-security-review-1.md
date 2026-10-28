# ENG-461: security review 1 — relay, linking and push (RX1)

Reviewed source at `0224350c2e3325341c448caebfd48ef228d413bd`, including the accepted
RV adversarial review. This is a findings-only review: it changes no product code, service,
deployment or credential. No Critical finding was established. The ranked result is eight High,
two Medium and one Low finding.

The threat model includes a malicious or compromised relay operator, a network attacker, a stolen
or compromised phone, a leaked link QR/clipboard value, a malicious Extension and another relay
tenant. Findings describe the smallest security boundary that failed; availability-only product
limits are noted separately.

## Ranked findings

### RX1-1 — High: a Linked Device can plant a second device key that survives its revocation

- **Location:** `packages/protocol/src/grants.ts:79`–`88` and
  `apps/daemon/src/transport/handlers.ts:366`–`375`. The unvalidated write is
  `apps/daemon/src/linkedDevices/route.ts:321`–`325`.
- **Exploit scenario:** every Relay session is annotated as a Linked Device, but the Grant gate
  still treats it as a token-less Client. It may call `devices.add`, `devices.link`,
  `devices.unlink` and `relayRoute.*`, not only ordinary cockpit RPCs. An attacker controlling an
  unlocked or compromised linked phone calls `devices.add` with another relay identity and Noise
  key. The owner later unlinks the known phone; the planted key remains linked and retains full
  Client authority. The same connection can instead mint a fresh five-minute link credential.
- **Evidence:** a temporary probe used the real relay, Daemon, Noise session and RPC server. The
  linked phone added an attacker key, the attacker opened its own session, and that session still
  listed an active attacker row after the Desktop App unlinked the original phone. The three-file
  scoped route suite passed with this assertion; the probe was removed afterwards.
- **Smallest fix:** distinguish local Desktop Client connections from `ConnectionDevice`
  connections in authorization. Refuse Linked Devices access to route configuration and device
  trust-management RPCs (`devices.link`, `awaitLink`, `add`, `unlink`, and `relayRoute.*`). Keep
  own-device push registration bound to `ConnectionDevice`. Add a regression that a linked phone
  cannot add a key or mint a link before or after its own revocation.

### RX1-2 — High: Cancel hides the link panel but leaves its credential usable

- **Location:** `apps/desktop/src/renderer/features/devices/LinkPanel.tsx:145`–`148` and
  `apps/daemon/src/linkedDevices/route.ts:257`–`266`, `283`–`312`.
- **Exploit scenario:** the panel's **Cancel** action only invalidates a React attempt number and
  closes the UI. There is no cancel RPC in `packages/protocol/src/linkedDevices.ts`; the Daemon
  keeps the secret address in its peer set until its five-minute timer expires. Someone who
  photographed the QR code, read a copied link, or received it accidentally can therefore link a
  full-power Client after the owner pressed Cancel and reasonably believed the credential was
  revoked. Reopening the panel creates another live credential rather than replacing the old one.
- **Smallest fix:** add a `devices.cancelLink` RPC scoped to the local Desktop Client. It must call
  `closeLink`, remove the temporary relay peer and fail the waiter. Invoke it on Cancel, unmount,
  superseding link creation and terminal Desktop teardown. Test that the exact cancelled link can
  no longer complete a Noise handshake.

### RX1-3 — High: Mobile “Unlink” forgets local keys without revoking them on any Host

- **Location:** `apps/mobile/src/relay/RelayProvider.tsx:129`–`146`; the user-facing action is
  `apps/mobile/src/hosts/HostsScreen.tsx:168`–`175`. Keys are deleted in
  `apps/mobile/src/relay/store.ts:65`–`68`.
- **Exploit scenario:** tapping **Unlink** clears SecureStore and local state and best-effort removes
  push registrations, but it never calls `devices.unlink` on a Host. Every Host continues to list
  and accept the old relay identity and Noise key indefinitely. A phone compromise that extracted
  those software-held keys therefore survives the apparent Unlink action, and relinking creates a
  new device record without revoking the old one. The phone has deleted the only local material it
  could use to identify and revoke the stale record later.
- **Smallest fix:** while the current keys and Host connections still exist, locate this device by
  relay address/key and call `devices.unlink` on every reachable Host. Do not erase the keys until
  revocation results are recorded; surface offline/failed Hosts with explicit Desktop cleanup
  guidance. Test that the old key is refused by each Host after Mobile Unlink, including partial
  failure and retry behavior.

### RX1-4 — High: production can select the test file secret store on macOS

- **Location:** `apps/daemon/src/secrets/index.ts:44`–`48`.
- **Exploit scenario:** an ordinary production Daemon inheriting `POLARIS_SECRETS=file` stores
  relay identity, Noise keys and provider credentials under `~/.polaris/secrets` instead of the
  macOS Keychain. This silently changes the Host identity and weakens the platform storage policy.
- **Evidence:** accepted RV probe RV1 resolved the production Layer in a non-test process and
  observed store `file` without reading or writing credential values.
- **Smallest fix:** remove the runtime environment override from production composition and inject
  the file-backed Layer only from test entry points.

### RX1-5 — High: a cold-start approval response is cleared before its Host loads

- **Location:** `apps/mobile/src/push/usePush.ts:59`–`82`, especially the unconditional clear at
  line 75.
- **Exploit scenario:** an authenticated notification action launches a killed app before
  SecureStore and the Host registry finish loading. `sendAnswer([])` returns `no-host`, but the
  finally block permanently clears iOS's last response. No later Host load retries it and the user
  gets neither a delivered decision nor a failure indication.
- **Evidence:** accepted RV probe RV2 rendered the real hook around a fake native notification
  boundary and reproduced one clear with zero dispatches after the Host later appeared.
- **Smallest fix:** retain a stable pending response until Host initialization and delivery reach a
  terminal outcome. Clear only after acknowledgment or an explicit user-visible failure path.

### RX1-6 — High: valid Unicode push content can close the multiplexed Host relay socket

- **Location:** `apps/daemon/src/push/plan.ts:93`–`99`; the enforced limit is
  `packages/protocol/src/relay/wire.ts:114`–`115` and relay failure is
  `apps/relay/src/server.ts:209`–`213`.
- **Exploit scenario:** display strings are truncated by UTF-16 code units, not by serialized
  UTF-8 plus HPKE/base64 size. Valid CJK or emoji content can produce a wake over 3,000 characters.
  The relay rejects the whole control message and closes the Host socket, interrupting every
  Linked Device session on that Host as well as losing the notification.
- **Evidence:** accepted RV probe RV3 produced a 3,416-character sealed wake from schema-valid CJK
  content; the real relay decoder rejected it.
- **Smallest fix:** budget the encoded plaintext, fixed HPKE overhead and base64 expansion before
  sending; truncate display fields by bytes/code points until the complete wake fits, and fail
  locally without writing an oversized control frame.

### RX1-7 — High: a stale APNs 410 deletes a newer push registration

- **Location:** `apps/daemon/src/linkedDevices/route.ts:361`–`377`.
- **Exploit scenario:** wake A is in flight, the phone registers token B, then APNs answers 410 for
  A. The completion clears by device id alone and deletes B. Mobile still considers its current
  registration epoch sent, so notifications can remain disabled until a later reconnect or
  settings change.
- **Evidence:** accepted RV probe RV4 held the old wake while using the real RelayRoute, SQLite
  store, ticket validation and sealing, registered B, then observed the target disappear when A's
  response completed.
- **Smallest fix:** compare and delete the exact registration generation/token/environment in one
  store operation; a stale response must not clear a replacement.

### RX1-8 — High: copied link credentials become ordinary clipboard-history entries

- **Location:** `apps/desktop/src/main/secretClipboard.ts:13`–`21`.
- **Exploit scenario:** **Copy link** writes the full one-time credential as ordinary clipboard
  text. A clipboard-history or sync consumer can retain it immediately, before the conditional
  60-second clear. Anyone reading that history during the five-minute link lifetime can become a
  full-power Client; clearing the current clipboard does not delete the retained copy.
- **Smallest fix:** use native concealed/transient pasteboard markers and retain conditional
  clearing. Decide explicitly whether cross-device paste is worth exposure to clipboard sync;
  local-only prevents that advertised flow.

### RX1-9 — Medium: transport key directions diverge from the Noise Split contract

- **Location:** `packages/protocol/src/relay/party/channel.ts:185`–`190`.
- **Exploit scenario:** Polaris passes `noise.rx` as its sending key and `noise.tx` as its receiving
  key. Both current parties share the reversal, so their own tests interoperate, but an independent
  Noise IK implementation using the specification's initiator-to-responder Split key fails
  authentication on its first transport record.
- **Evidence:** accepted RV probe RV6 completed a raw handshake against the real responder. The
  spec-direction key failed while the library's reversed `rx` convention succeeded. The installed
  `noise-handshake@4.2.0` README labels `rx` for sending and `tx` for receiving but also contains a
  contradictory example; the library is otherwise an Apache-2.0 implementation over
  `sodium-universal`. This is an interoperability failure, not a demonstrated confidentiality
  break between current Polaris clients.
- **Smallest fix:** align directions with Noise Split before an external client ships and add an
  independent transport vector, not another test through the shared wrapper. Plan compatibility
  if a deployed client already depends on the reversed wire format.

### RX1-10 — Medium: the Daemon accepts a non-loopback Relay route without TLS

- **Location:** `apps/daemon/src/linkedDevices/settings.ts:42`–`48`; the Desktop field forwards it
  unchanged at `apps/desktop/src/renderer/features/machines/RelayRoute.tsx:118`–`124`.
- **Exploit scenario:** `ws://relay.example` is accepted silently. A network attacker can
  impersonate the relay to the Host, learn its relay public identity and full Linked Device peer
  set, observe APNs tokens/tickets and sealed wake timing, suppress or forge delivery outcomes,
  and disconnect all remote sessions. Noise still protects RPC plaintext, but the control and
  push metadata are outside Noise. Link consumption already refuses non-loopback `ws://` in
  `packages/client/src/relay/link.ts:19`–`40`, leaving the Host policy both weaker and internally
  inconsistent.
- **Smallest fix:** share `secureRelayUrl` policy: require `wss://` except explicit loopback
  development addresses. Reject insecure saved settings on load or require an unmistakable local
  development override; do not silently reconnect them in production.

### RX1-11 — Low: a compromised relay can reuse learned APNs tokens for generic push spam

- **Location:** `apps/daemon/src/push/README.md:35`–`42`; the push service authenticates only the
  relay request at `apps/site/app/api/push/_lib/index.ts:110`–`138`, then accepts token/payload at
  lines 141–150.
- **Exploit scenario:** the relay legitimately sees each APNs token and holds the shared push
  service HMAC secret. A compromised operator can submit arbitrary sealed garbage for a learned
  token without presenting the device's push ticket to the push service. HPKE decryption fails, so
  the Notification Service Extension preserves APNs's generic **Open Polaris** alert: the attacker
  cannot inject approval text or actions, but can create durable nuisance/phishing-like alerts and
  retain the token beyond unlink.
- **Smallest fix:** make the push service validate a device-bound authorization, or register a
  token-to-device binding outside the relay operator's sole control and require it on delivery.
  Rotate/revoke that binding with token rotation and unlink.

## Construction and control review

- **Relay isolation:** Ed25519 challenge proofs bind role and fresh nonce; relay addresses derive
  from public keys. The in-memory Hub only routes opposite roles when the Host lists the device,
  rejects same-role/other-tenant delivery, replaces duplicate identities and enforces connection,
  byte, message, peer and wake limits. No cross-tenant plaintext path was found.
- **End-to-end channel:** the construction is Noise
  `IK_25519_ChaChaPoly_BLAKE2b`, with the Host static key pinned by the link and the device static
  key checked before the responder sends. Record type and session tag are authenticated as AD,
  records are ordered by cipher nonce and sessions stop before nonce exhaustion. The chosen
  library delegates X25519/ChaChaPoly/BLAKE2b to libsodium; RX1-9 is the material library-contract
  issue found.
- **Linking:** the 32-byte secret derives a throwaway relay identity and keys a BLAKE2b proof over
  the device Noise key and address. A link is single-use and expires after five minutes. Existing
  Host identities are pinned on Mobile, so a later envelope cannot silently replace a known Host.
  RX1-1, RX1-2 and RX1-8 are the trust-expansion, cancellation and leakage gaps.
- **Key storage:** Host relay secrets use HostSecrets/Keychain on macOS except RX1-4. Mobile relay
  keys use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the push-decryption key separately uses
  `AfterFirstUnlockThisDeviceOnly` so the Notification Service Extension can run while locked.
  Relay/link values were not found in normal logs.
- **Push encryption and authentication:** the Daemon uses RFC 9180 HPKE base mode with
  DHKEM(P-256, HKDF-SHA256), HKDF-SHA256 and AES-256-GCM through `@hpke/core@1.9.0`; Swift opens
  the same suite with CryptoKit. The device signs a ticket over Host address, APNs environment and
  token. Relay-to-site requests use HMAC-SHA256 over method, path, timestamp, nonce and body hash;
  production APNs JWTs are KMS-signed for one hour and cached for 55 minutes. Provider tokens,
  device tokens, headers and payloads are excluded from wide events.
- **Notification actions:** every approval action sets `isAuthenticationRequired: true`; responses
  become `RespondToApproval` only after HPKE-authenticated content is transformed by the Extension
  and are dispatched over the authenticated Host session. Another Linked Device cannot register
  push for a target id: register/unregister derive the caller from `ConnectionDevice`. RX1-5 is the
  cold-start delivery gap.
- **Malicious Extensions:** the Grant gate refuses `relayRoute.*`, `devices.*`, secret settings and
  unrestricted commands to token-bearing Extensions. No path from an Extension Grant to relay
  keys, link credentials, push keys or device management was found.
- **Logging:** relay events contain only outcome/counters, opaque per-connection ids and duration;
  Daemon push logs contain notification kind/outcome; the site event stores deployment, outcome,
  APNs reason/status and token source, never request bodies, headers, device/provider tokens or
  error messages. No credential-bearing log sink was found in the reviewed path.

## Non-findings and remaining acceptance work

- Unlink from the Desktop App updates the peer set and drops the open session; the accepted RV
  network probes did not reproduce commands executing after Desktop unlink returned. A narrower
  pre-admission queue observation remains investigation material, not a ranked network exploit.
- Push actions require device authentication. No physical iPhone, lock-screen action, native
  clipboard-history, simulator, deployed WSS relay, live APNs, KMS or Upstash call was made.
- A missing shared Upstash store makes replay nonces and APNs provider-token caching per Vercel
  instance. A network attacker still needs a valid relay HMAC request over TLS, and a compromised
  relay already possesses the signing secret, so no additional ranked exploit was established.
- Push is best effort: unavailable/rate-limited wakes are not queued, and resolving an approval
  elsewhere does not withdraw an already delivered notification. These are delivery-policy limits.
- The cancelled Codex Security Deep Scan did not produce a completed scan or canonical findings
  artifact and is not evidence for this report. RX1 was completed by direct source/data-flow review,
  the accepted RV evidence and the targeted real-path probe described above.

## Verification

All commands used Bun 1.4.4. The temporary RX1 probe initially failed because the sandbox refused
loopback bind, then passed with local-listener permission: **3 pass, 0 fail**. Its first corrected
assertion exposed that `devices.list` retains unlinked audit rows; the probe was adjusted to assert
the planted row's `unlinkedAt === null`, passed, and was removed. Existing accepted RV receipts
cover 116 passing scoped tests across relay, Daemon, site, protocol, Mobile, Client and Desktop.

The committed report is checked with the repository quality runner and `git diff --check`. No
full-repository test/typecheck, performance benchmark or live-service test is claimed for this
findings-only change.
