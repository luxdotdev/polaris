# ENG-458 foundation adversarial review

Reviewed merged Lead head `25675232e14862112efeec477e682b98ffe709a6` on FV.
Scope: F1 Mobile App scaffold, F2 Midnight tokens, F3 continuity, including their
Desktop App integration. Compared their changes with common ancestor
`98dc05df16b289278124941fe54386a9bd45730a`; excluded Relay and APNs implementation.
This report changes no implementation. Findings are ranked by user consequence.

## Findings

### 1. Critical: leaving during a failed draft write loses newer typing

Location: `apps/desktop/src/renderer/features/session/continuity.ts:124`
(also `:79-81`, `:53`, `:35`). Verified through the real hook and UI store with
the fake IPC bridge.

Failure scenario: load Host draft `old`, type `new`, and leave the last open
session while the Host is away. Cleanup starts `flush` without awaiting its
result, then removes the Host's DraftSync and clears its slots. The failed
write puts `new` back into a detached slot. The UI store still holds `new`, but
reopening creates a fresh DraftSync unaware of it. The Host snapshot's `old`
revision is then adopted unconditionally, silently replacing `new`. The new
typing was never saved anywhere else.

Smallest fix: retain dirty/in-flight per-session sync state across view release
and reacquisition, and retry on reconnect before adopting older Host text.
Awaiting flush alone is insufficient if a failed flush is still disposed.
Cover failed flush, navigation away, reconnect and reopening with the same UI key.

### 2. Critical: an older failed write can overwrite a newer successful write

Location: `packages/client/src/continuity/index.ts:135`
(overlap is allowed at `:126-130`). Verified through real DraftSync with
independently controlled save promises.

Failure scenario: start save A (`old`), then type and start save B (`new`) while
A is unresolved. Let B succeed first, then let A fail (for example A belongs to
the dropped connection and B to the replacement). A's failure sees no pending
text and puts `old` back into `pending`. The next flush sends `old`, replacing
the successfully saved `new` on the Host. The observed save sequence is
`old`, `new`, `old` without another user edit.

Smallest fix: serialize writes per session, coalescing intervening edits, or
track local edit generations so an obsolete failure cannot restore old pending
text. Flush must drain the latest generation. Test failures and successes in
both completion orders with each request's own text and result.

### 3. High: a remotely cleared draft survives reconnect

Location: `apps/desktop/src/renderer/features/session/continuity.ts:35`;
snapshot omission originates at `apps/daemon/src/store/continuity.ts:77`.
Verified through the real renderer hook with authoritative snapshots.

Failure scenario: the Desktop App receives non-empty draft X, loses its feed,
and the other Client clears/sends X. On reconnect the Daemon's snapshot omits
empty drafts, and the Desktop App only iterates drafts present in it. Nothing
clears X from the local composer. The same happens when the session was closed
while the other Client cleared it. Already-sent text reappears as unsent text
and can be sent twice.

Smallest fix: reconcile snapshot absence as a clear for clean local slots/UI
drafts, preserving dirty local text. Including persisted empty drafts with
their revisions is another way to carry the missing tombstones. Add a
reconnect test where an intervening remote clear is absent from the snapshot.

### 4. High: failed read reports are cached permanently

Location: `apps/desktop/src/renderer/features/session/continuity.ts:102-103`.
Verified through the real hook, a failed IPC result, and remounting the same
session after restoring the bridge.

Failure scenario: a completed Turn is visible while its Host is reconnecting.
`markRead` records the Turn in `reported` before the request succeeds and
ignores the result. When the Host returns, a visibility change or reopening
the same session skips the request because that Turn is already cached. Other
Clients retain the wrong unread count until a newer Turn is reported or the
renderer restarts. Reopening produced only the original failed RPC.

Smallest fix: distinguish in-flight reports from acknowledged positions; cache
only success, retain failed reports, and retry on reconnect while the session
is visible. Cover a refused report followed by a successful connection without
requiring a new Turn.

### 5. High: an active Turn becomes unread when it needs approval

Location: `packages/protocol/src/continuity.ts:81`.
Verified helper output against the real Session State machine's transitions
(`apps/daemon/src/engine/session.ts:327-333,475`).

Failure scenario: with one active Turn and no read position, `unreadTurns`
returns zero in Working. An approval moves the session to Needs You without
ending the Turn; the helper now returns one. An answer can move it back to
Working and reduce the count to zero. This contradicts the helper's contract
that only ended Turns count and will give every future Client the same wrong
indicator.

Smallest fix: derive the ended count from actual Turn status, or expose an
authoritative ended-Turn count in the shared session summary. Do not merely
subtract for all Needs You sessions: recovery also uses Needs You with an
already interrupted Turn. Test approval/question, interrupted recovery, and
In Terminal with an active Turn.

### 6. Medium: an initial mobile connection failure has no retry action

Location: `apps/mobile/src/hosts/useHostFeed.ts:53-54`
(effect dependency at `:64`; same-value save at `apps/mobile/src/App.tsx:52`).
Confirmed by source tracing; not rerun in the simulator.

Failure scenario: launch with a saved pairing while the Daemon is offline,
then bring the Daemon up. The SDK deliberately fails rather than retries a
Host it has never reached (`packages/sdk/src/link.ts:183`). The hook ends in
`failed`, and saving the same pairing does not change the effect dependency.
The developer must clear/change the pairing or restart the app to connect.

Smallest fix: expose an explicit retry action/attempt key for initial failure,
or retry transient first-connection failures with the existing connection
policy. Test initial failure followed by recovery with the same pairing.

## Standards and spec assessment

No separate serious standards violation or Midnight token defect found.
The token drift checks compare independent CSS and TypeScript sources, and
the runtime checks exercise real shared code. No clearly tautological test
was identified. There is one inaccurate concurrency fake:
`packages/client/src/continuity/continuity.test.ts:58-59` resolves the oldest
save promise with the newest request's text (`saves.at(-1)`). Capture each
request's text with its resolver before adding overlapping-write coverage.

Continuity's exclusion from the command/event-log spec is explicit in ADR 0082
and `packages/spec/README.md`, and the reviewed changes do not alter that
command path. The missing unread UI, saved caption, attachment syncing and
full Mobile App screens are disclosed dependency limitations, not new findings.
The failures above violate the continuity behavior beneath those screens.

Follow-up tracking: [ENG-464](https://linear.app/luxdev/issue/ENG-464) covers
findings 1-5 and the overlapping-write fake;
[ENG-465](https://linear.app/luxdev/issue/ENG-465) covers finding 6. Both are
children of ENG-458, targeted to Polaris 0.4.0. This review leaves them Todo.

## Evidence and limits

- A temporary five-case reproduction file ran against the real DraftSync,
  renderer hook and UI store, with fakes only at IPC/save boundaries:
  **5 pass, 0 fail, 7 assertions**. These assertions verified the bad outcomes
  described in findings 1-5; they are not passing regression tests for intended
  behavior. The temporary file was removed before committing this report.
- Existing focused tests: client continuity **6 pass**, Desktop continuity
  **2 pass**, Mobile Hermes check **2 pass, 1 skip**, Midnight **5 pass**.
  The skipped check requires the unbuilt Hermes VM; hermesc compilation and
  the Bun self-check passed.
- Daemon continuity tests initially failed because the sandbox refused Unix
  socket binds. The same file rerun outside the sandbox: **3 pass, 0 fail**,
  including two-Client writes, persistence across restart, and migration seeding.
- Required full checks: `bun run typecheck` **17/17 tasks successful**;
  `bun run lint` **passed**, with formatting clean and no ratchet increases.
  `bun run test` **failed**, **15/18 tasks successful**: Desktop failed and
  Turbo terminated Daemon/spec with exit 130. Failures appeared in Desktop
  `src/main/machines/service.test.ts` and `src/renderer/features/session/diffSyntax.test.ts`,
  Daemon `src/reviewer/{instructions,compose}.test.ts` and `src/accept/shared.test.ts`,
  and spec Constellation real-log replay. Most were five-second timeouts;
  the replay cases reached 120 seconds. The measured Host load average was
  **127.23** during the run. None touches the report's implementation diff
  (there is none); load is a plausible contributor, not a proven diagnosis.
  Full-suite failures were not repaired or hidden, and timeout settings were
  unchanged. Logs remain at `/tmp/fv-{typecheck,lint,test}.log` on this Host.
- No simulator or physical-device run, quiet-host benchmark, Apalache or new
  live-service smoke was performed for this review. Boundary-fake reproductions
  do not establish real-network timing, but directly exercise the production
  logic responsible for the reported outcomes.
