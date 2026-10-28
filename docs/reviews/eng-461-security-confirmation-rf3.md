# ENG-461: security confirmation after RF3 (RX4)

Reviewed RF3 at `33de03c710f67fe2b4201d12f7cb152d7b390f38` from source and with focused
protocol, gate, Relay and Mobile tests. **Verdict: do not ship.** RF3 makes the
`StartSession` payload check fail closed and refuses non-null `origin`, with no regression found in
that gate, but two other device-allowed Commands still carry authority the Mobile App does not use.

The user has since decided that every permission mode, including `full-access`, is intended on a
Linked Device. Task SM owns that part of the gate, so RF3's refusal of `full-access`
is not a finding here.

## Ranked findings

### RX4-1 — High: a Linked Device can revert later Turns without a Mobile surface

- **Location:** `AcceptTurns` remains tag-only at
  `packages/protocol/src/deviceGrants.ts:258` and `270`–`277`. Its payload includes
  `revertLaterTurns` at `packages/protocol/src/commands.ts:147`–`152`, while Mobile always sends
  `false` at `apps/mobile/src/review/actions.ts:41`–`46`.
- **Exploit:** a stolen or compromised Linked Device names an earlier completed Turn and sends
  `revertLaterTurns: true`. The Daemon passes the value through at
  `apps/daemon/src/engine/review.ts:35`–`52`; the acceptance reactor restores affected files to the
  earlier checkpoint and records the later Turns as reverted.
- **Fix:** make `AcceptTurns` a payload-checked device Command, exhaustive over its fields, and
  require `revertLaterTurns: false`. Add a Relay regression where `false` reaches the Engine and
  `true` is refused with `NotGranted` before dispatch.
- **Regression status:** a targeted gate probe reports `AcceptTurns allowed` for `true`. RF3 did
  not introduce the gap; it remains from the tag-only RF2 allowlist.

### RX4-2 — Medium: a Linked Device can persist an everywhere-scoped Verdict

- **Location:** `RecordVerdict` is tag-only at `packages/protocol/src/deviceGrants.ts:264` and its
  payload accepts every `VerdictScope` at `packages/protocol/src/commands.ts:177`–`186`. Mobile
  hard-codes `scope: "repo"` at `apps/mobile/src/review/actions.ts:98`–`113`.
- **Exploit:** a compromised Linked Device records a valid Verdict with `scope: "everywhere"`.
  The Daemon persists the scope unchanged at `apps/daemon/src/engine/review.ts:149`–`166`. Its
  cross-repository learning effect is dormant until Risk Memory M6, but the broader authority is
  stored now and can survive into that release.
- **Fix:** payload-check `RecordVerdict` and admit only the scope Mobile exposes. Add direct-gate
  and Relay regressions for repo versus everywhere scope.
- **Regression status:** a targeted gate probe reports `RecordVerdict allowed` for `everywhere`.
  This is also a residual RF2 gap, not an RF3 regression.

## RF3 confirmation and remaining Command audit

- The gate decodes the full `Command`; an undecodable `StartSession`, non-null `origin`, effort,
  service tier, base ref, Existing Worktree or Review Checkout is refused. The field record is
  exhaustive over `StartSession`, so a new field fails typecheck until it is decided.
- Plan, supervised, auto-edits and auto reach the Engine. Task SM covers full-access.
  Session/workspace ids, harness, model, prompt, attachments and the accepted arbitrary branch are
  ordinary start choices; the accepted RF3 decision intentionally matches Desktop on branch names.
- `SendTurn`, `Steer` and `Interrupt` expose the Mobile thread surface. `RespondToApproval`'s
  remembered approval is used by Mobile's Always action. `SendFeedback` carries the same text and
  staged-attachment authority Mobile already has through `SendTurn`. No other payload-dependent
  authority was found.
- The Mobile contract test covers only two of the four plan/worktree combinations despite saying
  every sheet output is admitted. Protocol and Relay tests cover the complementary combinations,
  so this is a non-blocking test-quality gap rather than another authorization finding.

## Verification

- `bun test packages/protocol/src/deviceGrants.test.ts
  apps/daemon/src/extensions/connection.test.ts apps/mobile/src/newSession/model.test.ts`: 49 pass.
- `bun test apps/daemon/src/linkedDevices/route.test.ts`: 7 pass after a native loopback retry. The
  sandboxed aggregate attempt failed before the Relay tests because `Bun.listen` returned `EPERM`.
- A direct `decideDeviceAccess` probe confirmed `AcceptTurns` with revert, `RecordVerdict` with
  everywhere scope, and Mobile's remembered approval are all currently allowed.
- `bun run typecheck`: 17 package tasks passed.
- `bun run test`: 18 workspace tasks passed after a native retry, including 2,592 Daemon tests and
  the real later-Turn revert. The sandboxed attempt failed on loopback binds and `ps` spawning.
- `bun run lint`: formatting and the lint ratchet passed.

No physical iPhone, Face ID, deployed Relay or live push service was exercised. No benchmark was
needed for this report-only change.

## Decision (2026-10-28)

The user accepted RX4-1 and RX4-2 as intended authority. A Linked Device has the phone user's full
authority: every permission mode, reverting later Turns on Accept, and any Verdict scope, as on the
Desktop App. If access to the app ever needs limiting, Face ID gating is the answer, not a narrower
device gate. Hidden sessions (a non-null `origin`) stay refused.
