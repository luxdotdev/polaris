# ENG-461: security re-check after RF2 (RX3)

Reviewed RF2 at `80737dbdf5250083b788a660f7ea54eaa0abca02` from source, with focused
protocol, gate, Relay, linking, Mobile and push tests. **Verdict: do not ship** until RX3-1 is fixed.
RF2 closes the link completion race, and its RPC and Command tag allowlists otherwise fail closed
and match the Mobile App's production call sites, but `StartSession` still admits authority-bearing
payload variants the Mobile App never sends.

## Finding verdicts

| Prior finding | Verdict | Evidence |
| --- | --- | --- |
| RX2-1 | **Not closed** | `DEVICE_RPCS` and `DEVICE_COMMANDS` are exhaustive, use own-property lookup and refuse unknown tags. Every allowed tag traces to Mobile production source, and no needed tag was found refused. However, allowing the `StartSession` tag also allows every valid permission mode and Daemon-only origin value (RX3-1). |
| RX2-2 | **Closed** | `completeLink` rechecks `links.get(open.id) === open` while holding the same semaphore as `closeLink`. Cancellation or expiry that wins makes completion inert. The deterministic post-admission tests pass for both endings and prove no stored device and no reconnect. |

## Ranked finding

### RX3-1 — High: a Linked Device can start a hidden, full-access Agent Session

- **Location:** the device gate decides only the RPC and Command tags at
  `packages/protocol/src/deviceGrants.ts:204`–`205` and `241`–`248`, fed by the partial payload at
  `apps/daemon/src/extensions/connection.ts:160`–`168` and `192`–`219`. `StartSession` also carries
  `permissionMode` and `origin` at `packages/protocol/src/commands.ts:50`–`64`.
- **Exploit:** a stolen or compromised Linked Device dispatches a valid `StartSession` with
  `permissionMode: "full-access"`, `origin: "reviewer"` and an attacker prompt. The Engine preserves
  both fields (`apps/daemon/src/engine/decider.ts:284`–`324`). For Codex, full access is approval
  policy `never` with `danger-full-access` (`apps/daemon/src/harness/codex/mapping.ts:39`–`60`), so
  the new Agent Session can execute code without an approval boundary and continue after the phone
  is unlinked. The forged origin hides it from Mobile Home
  (`apps/mobile/src/home/model/home.ts:112`–`124`) and exempts it from auto-archive
  (`apps/daemon/src/engine/autoArchive.ts:108`–`116`).
- **Evidence:** the Mobile App constructs only `plan` or `supervised`, omits `origin`, and uses only
  in-place or new-worktree placement (`apps/mobile/src/newSession/model.ts:194`–`214`). A direct
  device-gate probe reported `allowed` for `plan`, `supervised`, `auto-edits`, `auto` and
  `full-access` because the gate never receives those fields.
- **Fix:** decode the device-specific `StartSession` fields at the gate. Allow only `plan` and
  `supervised`, require `origin` to be absent or null, and restrict the remaining payload variants
  (placement, effort and service tier) to the Mobile App's actual surface. Add real-gate or Relay
  regressions proving `auto`, `full-access` and non-null origin are refused while both Mobile modes
  pass.

**Permission-mode judgment:** controlling existing Agent Sessions from the phone is intended
authority: the product scope explicitly includes continuing them. `SendTurn` carries no permission
mode, and `SetPermissionMode` is already local-only, so `SendTurn` should remain allowed even for an
Agent Session whose mode the owner set on Desktop. A Linked Device should not be able to mint a new
bypass session merely because the tag-level allowlist admits `StartSession`.

## Regression review and verification

No other Relay, linking or push regression was found in RF2. The Relay regression refuses
`voice.setKey` and `RunShellCommand`; unknown RPC and Command tags, including prototype keys, fail
closed. The allowed RPC and Command tags otherwise map to Mobile production calls.

- `bun test packages/protocol/src/deviceGrants.test.ts`: 7 pass.
- `bun test apps/daemon/src/extensions/connection.test.ts`: 8 pass.
- `bun test apps/daemon/src/linkedDevices/route.test.ts`: 7 pass after an approved loopback retry,
  including both RX2-2 cases. The sandboxed run failed at `Bun.listen` with `EPERM` before tests.
- `bun test apps/mobile/src/newSession/model.test.ts apps/mobile/src/thread/composer.test.ts`: 31
  pass; Mobile starts only `plan` or `supervised`, and `SendTurn` does not switch mode.
- `bun test apps/daemon/src/linkedDevices/wake.test.ts apps/daemon/src/push/plan.test.ts
  apps/daemon/src/push/seal.test.ts`: 16 pass after an approved loopback retry. The sandboxed run's
  only failure was the fake push server's listen error.
- `bun run typecheck`: 17 tasks passed.
- `bun run test`: 17 of 18 package tasks passed. The Daemon ran 2,591 pass, 49 skip and 1 fail: the
  existing offline-linked-device push E2E observed `needs-you unavailable` instead of `sent`. Its
  isolated rerun, `bun test apps/daemon/src/push/push.e2e.test.ts`, passed (1 pass, 0 fail).
- `bun run lint`: format check and lint ratchet passed.

No physical iPhone, deployed Relay, live APNs or production credential store was exercised. This is
a report-only change; no product code, service, deployment or credential was changed.
