# ENG-461: security review 2 — relay, after fixes (RX2)

Reviewed source at `e330d9a3dc72768aa5daeeb636c5093b29f12068` independently before comparing
the RX1 and RV reports. This is a findings-only review: it changes no product code, service,
deployment or credential. The result is one High and one Medium finding. **Verdict: do not ship**
the Relay route until RX2-1 is fixed; fix RX2-2 before device acceptance as part of the same round.

The threat model remains a malicious or compromised relay operator, network attacker, stolen or
compromised phone, leaked link QR/clipboard value, malicious Extension and another relay tenant.

## Ranked findings

### RX2-1 — High: the Linked Device denylist leaves local-only authority reachable

- **Location:** `packages/protocol/src/grants.ts:313`–`336`. The current concrete credential write is
  `voice.setKey` at `packages/protocol/src/voice.ts:76`–`83`; `dispatch` is admitted as one RPC while
  its commands are classified only for Extensions at `packages/protocol/src/grants.ts:23`–`56`.
- **Exploit scenario:** a stolen or compromised Linked Device can invoke any new or existing Client
  RPC not remembered in `LOCAL_CLIENT_RPCS`. The shipped Mobile App never calls `voice.setKey`, but
  its Relay connection can replace or remove the Host's speech-provider credential. That value
  persists in HostSecrets after the owner unlinks the phone. The same boundary admits commands the
  Mobile App does not expose, including `RunShellCommand`; after starting or selecting a compatible
  Agent Session, an attacker can run a shell command on the Host and plant authority that survives
  device revocation. The UI's absence of these actions is not an authorization control.
- **Evidence:** `decideDeviceAccess("voice.setKey")` and `decideDeviceAccess("dispatch")` both return
  null at the reviewed head, while Mobile source uses `voice.transcribe` but has no `voice.setKey`
  call and has no `RunShellCommand` call. The RF regression proves the listed device-management
  tags are refused, but it cannot fail when another privileged RPC or Command is added or omitted.
- **Fix:** replace `LOCAL_CLIENT_RPCS` with explicit Linked Device allowlists for both RPC tags and
  `dispatch` Command tags. Make the classifications exhaustive with
  `satisfies Record<DaemonRpcTag, ...>` and `satisfies Record<Command["_tag"], ...>`, and default
  unknown strings to refusal. Allow only Mobile's source-traced feature surface (including
  `voice.transcribe`, feeds, review/Constellation reads and the device-bound push/self-unlink RPCs).
  Add real Relay regressions for `voice.setKey`, `RunShellCommand`, and a newly introduced RPC tag.

**Allowlist judgment:** yes. This is a security boundary and the denylist already missed a
persistent credential setter plus the entire Command namespace behind `dispatch`. An exhaustive
allowlist makes a new Daemon capability fail closed until Mobile authority is considered explicitly.

### RX2-2 — Medium: cancellation or expiry can lose a race after link admission

- **Location:** admission marks `open.used = true` in
  `apps/daemon/src/linkedDevices/route.ts:169`–`185`; cancellation deletes the entry at lines
  265–274; the reply's asynchronous completion calls the captured `complete` callback at
  `apps/daemon/src/linkedDevices/link.ts:271`–`295`, which stores the device without rechecking the
  link at `apps/daemon/src/linkedDevices/route.ts:154`–`167`.
- **Exploit scenario:** a leaked-link holder begins the Noise handshake just before the owner
  cancels or the five-minute timer expires. Admission consumes the link synchronously, then the
  reply waits behind the Relay pacer/socket drain. Cancellation removes the link and fails the
  Desktop waiter, but the already captured callback still adds the attacker's device when the
  reply finishes. A slow or adversarial Relay can widen the window. The Desktop App reports the
  link ended while the key becomes a full-power Linked Device.
- **Evidence:** the state transition is not atomic: `closeLink` has no revoked flag and
  `completeLink` does not check `links.get(open.id) === open`. Existing RX1-2 regressions exercise
  cancel-before-init, supersede-before-init and waiter interruption, not cancel/expiry after
  admission but before asynchronous reply completion.
- **Fix:** make link completion conditional on the entry still being current and unrevoked after
  the reply is written, or reserve/commit admission through a single state transition whose cancel
  wins. Add a deterministic test with the reply send held between admission and completion; cancel
  and expiry must leave `devices.list` empty and the captured callback must be inert.

## RF fix confirmation

| Prior finding | Result at RF head |
| --- | --- |
| RX1-1 | The named planting, link, Pairing, Remote Access and route-management RPCs are refused from a Relay connection using the transport's device identity. The direct exploit is closed, but the denylist boundary is incomplete (RX2-1). |
| RX1-2 | Cancel, unmount, superseding an unused link and interrupting `awaitLink` now call `closeLink`; ordinary stale credentials are closed. The post-admission completion race remains (RX2-2). |
| RX1-3 | `devices.unlinkSelf` derives the caller from `ConnectionDevice`; Mobile revokes each reachable Host before deleting keys and retains keys plus failed Hosts for retry. Closed, subject to physical-device acceptance. |
| RX1-4 / RV1 | Production no longer reads `POLARIS_SECRETS`; the file store is selected only by `main.testing.ts`. Closed. |
| RX1-5 / RV2 | Notification answers wait for Keychain Host loading within the existing 20-second budget and every non-sent terminal outcome schedules a local notice before clearing the response. Closed within the documented best-effort delivery policy. |
| RX1-6 / RV3 | Push fitting measures encoded UTF-8 plaintext and fixed HPKE/base64 overhead; a residual oversize is refused before writing to the Relay socket. Closed. |
| RX1-7 / RV4 | `clearPush(id, registration)` compares and deletes the exact serialized registration in one SQL statement. Closed. |
| RX1-8 / RV5 | The Desktop writes text and both macOS concealed/transient markers atomically, while retaining conditional clearing. Source fix is present; running Electron, clipboard-manager and Universal Clipboard acceptance remain unverified. |
| RX1-9 / RV6 | Both parties use `noise.tx` for send and `noise.rx` for receive under prologue `/2`; the RF test adds an independent CipherState direction check. Closed, with coordinated phone/Host update required. |
| RX1-10 | Daemon and Mobile share `secureRelayUrl`: WSS everywhere, WS only on exact loopback hosts; an insecure saved setting loads off. Closed. |
| RX1-11 | Unchanged and intentionally deferred to ENG-476. |

## Reviewed controls and non-findings

- Relay challenge proofs bind a fresh nonce and role; Hub routing remains opposite-role and
  Host-declared, with per-connection, per-address, message, byte, peer, wake and backpressure limits.
- Noise IK still pins the Host key from the link, proves the device static key before the reply,
  authenticates record type/tag as associated data and stops before nonce exhaustion. No plaintext
  path through the Relay was found.
- Push tickets bind device, Host, environment and token; Relay-to-site HMAC covers method, path,
  timestamp, nonce and body hash. HPKE-authenticated notification content is the only source of
  approval actions. RX1-11 remains the known compromised-Relay generic-spam limit.
- Device push registration, unregistration and self-unlink continue to derive the target from
  `ConnectionDevice`; caller-supplied device ids cannot redirect them.
- No credential-bearing log path was found in Relay, Daemon push or site wide events.

## Verification boundaries

Targeted source and tests cover the local Relay/Daemon, fake push service/APNs and shared protocol
paths. No physical iPhone, lock-screen action, running Electron clipboard manager, Universal
Clipboard, deployed WSS Relay, live APNs/KMS/Upstash or production service was exercised. No
benchmark was run for this report-only change. Full-repository typecheck and lint passed. The full
test run had one failure in the offline-device Relay push end-to-end test while 17 other workspaces
passed; that exact test passed both in the targeted security run and immediately when rerun alone.
