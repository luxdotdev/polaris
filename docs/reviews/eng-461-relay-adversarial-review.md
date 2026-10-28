# ENG-461: adversarial relay review (RV)

Reviewed integrated head `d3d5a051588cebffa47da59f8a789f01b26ec6d5`, containing R1–R6.
This is a findings-only review: no implementation fixes, deployment, Vercel or Railway changes.
Follow-up: [ENG-474](https://linear.app/luxdev/issue/ENG-474/address-rv-relay-correctness-findings-before-device-acceptance), on Polaris 0.4.0.

## Ranked findings

### RV1 — High: production can select the test file secret store on macOS

- **Location:** `apps/daemon/src/secrets/index.ts:46` (branch through line 48).
- **Failure scenario:** starting the ordinary Daemon with `POLARIS_SECRETS=file` selects
  `~/.polaris/secrets` instead of the macOS Keychain. There is no test-runner or test-build
  restriction. This affects provider credentials as well as relay identity and Noise secrets.
  It contradicts ADR 0079's Keychain policy and the operator's explicit test-only requirement;
  an inherited test environment can silently change the credential store and Host identity.
- **Evidence:** a non-test `bun -e` that only resolves `HostSecrets.layer` and prints its
  `store` returned `file` on this Mac. It did not read or write any credential.
- **Smallest fix:** remove the environment override from production composition. Supply a
  file-backed HostSecrets Layer explicitly in test entry points, as `startServer` already
  supports for its in-process tests. Compiled production builds must not expose that switch.

### RV2 — High: a cold-start approval response is cleared before its Host loads

- **Location:** `apps/mobile/src/push/usePush.ts:72` (unconditional clear at line 75).
  Related: `apps/mobile/src/push/deliver.ts:57`, `apps/mobile/src/relay/RelayProvider.tsx:78`.
- **Failure scenario:** an approval action launches a killed app. `useAnswers` immediately
  reads the last response, while RelayProvider is still asynchronously reading SecureStore.
  `sendAnswer([])` returns `no-host` immediately, rather than waiting for the registry to load.
  The finally block clears the saved response. Loading the Hosts later does not rerun this
  effect, and the user receives neither an answer nor a retry/error indication. The same
  unconditional clearing also discards offline and failed delivery outcomes.
- **Evidence:** a rendered probe ran the real `usePush` with a fake native notification
  boundary and initially empty Host registry. The saved Approve response was cleared once;
  adding an already-live matching Host and rerendering still produced zero dispatches.
  The existing `sendAnswer` test explicitly confirms the immediate `no-host` outcome.
- **Smallest fix:** keep a pending response until linked-Host initialization and connection
  readiness complete. Clear only after an acknowledged answer or deliberate terminal handling;
  preserve the stable commandId for an ambiguous retry and surface a failed delivery.

### RV3 — High: valid Unicode push content closes the Host's relay socket

- **Location:** `apps/daemon/src/push/plan.ts:93`–`99`.
  Related: `apps/daemon/src/push/seal.ts:32`,
  `packages/protocol/src/relay/wire.ts:115`, `apps/relay/src/server.ts:213`.
- **Failure scenario:** the planner truncates title/subtitle/body by UTF-16 character count.
  JSON UTF-8 encoding, HPKE overhead and base64 expansion can exceed the 3,000-character wake
  payload limit even though every PushMessage field passes its schema. The Daemon sends it
  without a budget check. Relay control decoding fails and closes the Host socket with
  `bad-control`, losing the push and interrupting every device's active session to this Host.
- **Evidence:** the real planner processed a SessionRenamed to 160 CJK characters followed by
  an ApprovalRequested with a 600-character CJK title and null detail. Real `sealPush` produced
  **3,416** payload characters. `decodeClientControl` rejected the resulting wake. An otherwise
  valid message at all three field limits produced 3,887 characters. No key or payload was logged.
- **Smallest fix:** budget the serialized UTF-8 plaintext, fixed HPKE expansion and base64
  expansion, truncating display fields until the complete sealed wake fits. Validate locally
  before sending so a content-size error cannot tear down the multiplexed Host connection.

### RV4 — High: an old APNs 410 deletes a newly registered token

- **Location:** `apps/daemon/src/linkedDevices/route.ts:374`–`377`.
- **Failure scenario:** a wake for token A is in flight. The device reconnects or refreshes its
  token and registers B. A's delayed `unregistered` response then calls `clearPush(device.id)`,
  deleting B too. The app believes its current epoch is registered (`usePush.ts:132`–`135`),
  so push can stay disabled until a later reconnect or setting change. With the last target
  removed, the notifier also stops following the Host stream.
- **Evidence:** a probe used the real RelayRoute, SQLite LinkedDevices store, signing, public
  key validation and sealing, with only the relay link faked. It held A's wake, registered B,
  observed one current target, then released A as `unregistered`: the target count became zero.
- **Smallest fix:** clear only if the stored registration still matches the failed token,
  environment and registration generation. Make comparison and deletion one store operation.

### RV5 — High: copied link credentials are ordinary clipboard history entries

- **Location:** `apps/desktop/src/main/secretClipboard.ts:18`.
  Caller: `apps/desktop/src/main/index.ts:459`.
- **Failure scenario:** Copy link writes the one-time linking credential as plain clipboard
  text with no concealed/transient marker or local-only policy. A clipboard-history consumer
  can retain it immediately, before the 60-second cleanup. Someone reading that history while
  the five-minute link is live can link a full-power Client. Clearing the current clipboard
  cannot remove a history copy, and the timer also depends on the Desktop process staying alive.
- **Evidence:** the actual writer is R3's Desktop code; R4's Mobile screen accepts pasted
  input and does not write the clipboard. The writer abstraction only offers readText,
  writeText and clear. Its two tests cover timed cleanup and preserving a later clipboard
  value, with no sensitive-entry handling. Native clipboard-history behavior was not exercised.
- **Smallest fix:** write sensitive pasteboard markers with the credential, retaining
  conditional cleanup. Choose cross-device clipboard behavior deliberately: making this
  local-only affects the advertised Mac-to-iPhone paste flow. Do not rely on the timer alone.

### RV6 — Medium: transport key directions diverge from Noise's Split contract

- **Location:** `packages/protocol/src/relay/party/channel.ts:190`.
- **Failure scenario:** `sessionOf` passes `noise.rx` as the send key and `noise.tx` as the
  receive key. The installed library's implementation assigns the first Split key to the
  initiator's tx and the responder's rx. Noise specifies that first key for
  initiator-to-responder traffic. Both current Polaris parties share the reversal, so their
  round trips pass, but an independently implemented transport using the specified direction
  fails authentication immediately. This was already disclosed in R4's follow-ups.
- **Evidence:** a probe completed a real raw Noise handshake against `acceptHandshake` and
  encrypted the first transport record with a fresh CipherState using initiator tx and the
  Polaris record-header AAD. The Host rejected it; using rx instead succeeded.
  The installed README contains conflicting direction guidance; the implementation and
  [Noise specification, section 5](https://noiseprotocol.org/noise.html#processing-rules)
  establish the mapping. This is an interoperability finding, not demonstrated key compromise.
- **Smallest fix:** align send/receive directions together before external clients ship and
  add a transport-vector check independent of the shared wrapper. Account for compatibility
  if any deployed clients already depend on the reversed format.

## Requested checks and boundaries

- **Reconnect/resume:** the Mobile App's real local relay/Daemon e2e test passed: one snapshot,
  unique ordered sequences, and delivery of an event made during the relay restart. Relay
  reconnect, replacement, peer-removal and channel replay/tamper tests also passed.
- **Revocation:** a direct real-server probe can execute one buffered RPC if handed an
  already-ended and unlinked DeviceSession before server admission. The queue drains on end,
  and the server does not revalidate the device at this interface. However, two network probes
  (self-unlink followed by a batch, and Desktop unlink during a 3,000-request batch) did **not**
  reproduce execution after unlink returned. The first fixture also timed out before it had
  completed Client hello. These are investigation results, not a ranked revocation exploit.
  A future test should control the connection-start boundary rather than infer a reachable
  scheduling window from queue behavior alone.
- **R4 Keychain accessibility:** relay keys use WHEN_UNLOCKED_THIS_DEVICE_ONLY, so an unattended
  locked cold start cannot read them. Approval actions all set authenticationRequired; Apple
  documents that the device unlocks before the app is notified, supporting access to protected
  data ([Apple action documentation](https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/authenticationrequired?language=objc)).
  The push-decryption key separately uses AfterFirstUnlockThisDeviceOnly. No blanket Face ID
  incompatibility is claimed. Recovery after a locked initialization failure and physical
  lock-screen action delivery remain untested here.
- **R6 authority:** the register/unregister handlers derive the device from ConnectionDevice,
  accept no target device id, and store its own registration. Another Linked Device cannot
  directly change that row's automatic switch through these handlers. R6's emitted `notify`
  messages have null requestId/category and use the existing session/Constellation navigation
  path; approval responses still dispatch over the authenticated Host connection. No new
  push-command authority was found. `answerOf` could defensively require kind `needs-you`,
  but a crafted notify with a requestId was not treated as an independently reachable exploit.
- **Delivery limits:** unavailable/rate-limited wakes have no retry or queue; a newly pending
  approval during a relay outage does not get a later push merely because the relay returns.
  Existing delivered approvals are not withdrawn when resolved elsewhere. Automatic causes
  limited within 30 seconds retry only on a later graph event. Reverse-order automatic/agent
  notifications can duplicate, as R6 disclosed. These are existing delivery-policy limits,
  distinct from the newly reproduced RV2–RV4 failures.
- **Idle cost:** no new performance measurement was made. Source inspection found no new
  permanent idle polling timer in the notifier; its settle timer is event-driven. The accepted
  R2 Claim's loaded-host A/B and scratch socket-cost figures are Reported evidence, not a clean
  baseline pass by RV. Off-tailnet WSS, live APNs/KMS/Upstash, physical iPhone decryption and
  lock-screen answers remain acceptance work. None was deployed or called in this review.

## Verification

All commands used Bun 1.4.4. These are Reported receipts, not invented Daemon item references.

| Command | Result |
| --- | --- |
| `bun test apps/relay/src` | 29 pass, 0 fail |
| `bun test apps/mobile/scripts/relay.e2e.test.ts` | 3 pass, 0 fail |
| `bun test src/push src/constellation/attention.test.ts src/mcp/sessions/sessions.test.ts` in `apps/daemon` | 23 pass, 0 fail |
| `bun test app/api/push` in `apps/site` | 20 pass, 0 fail |
| `bun test src/relay` in `packages/protocol` | 17 pass, 0 fail |
| `bun test src/push` in `apps/mobile` | 16 pass, 0 fail |
| `bun test packages/client/src/relay/link.test.ts apps/desktop/src/main/secretClipboard.test.ts` | 8 pass, 0 fail |
| Temporary probes for cold-start answer, Unicode overflow, stale 410, Noise directions | Each reproduced the named failure; 4 pass, 0 fail |
| Non-test HostSecrets store-selection probe | `file`, exit 0; no credential access |

The initial sandbox attempts could not bind fake loopback APNs/relay sockets. Daemon tests
reported 15 pass, 2 fail and 1 setup/teardown error; the site attempt emitted a bind error and
remained open, then was stopped. Both scopes passed when rerun with local-listener permission.
No assertion or implementation was weakened. Test-service limits: fake APNs/provider tokens,
local relay, no physical device. No full-repository suite, simulator, typecheck or benchmark
was run for this report-only change. Scoped checks and commit hooks cover the submitted artifact.

Temporary probe files were removed before commit. Their restoration patch and captured logs
are under `/private/tmp/rv-review-evidence/`; apply the confirmed-probes patch to the reviewed
head to rerun them. That archive is local supporting evidence, not a committed test suite.
Only this report is committed, outside the assignment's empty declared Area.
