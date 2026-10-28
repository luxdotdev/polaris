# ENG-458 Duo and screens follow-up re-check

Reviewed integrated lead head `1a27f5f015cd558e2a2705bc69dc9e61b60487cf`,
containing DF1 `ffc1f2c2`, DF2 `d31078b2` and DF3 `9f47162c`.
Contract: findings 1–10 of `eng-458-duo-screens-followup-review.md`, plus
regressions from their fixes. Report only; no implementation changes.

Result: seven fixed at the source/test level, three partial. One confirmed P1
regression; two P2 continuity gaps remain. Track the remaining work in
[ENG-471](https://linear.app/luxdev/issue/ENG-471).

The user is judging a Claim or Turn and continuing the conversation on the
right Host. The Daemon owns mechanical state; the user chooses Accept.
Sources: DESIGN.md, iPhone Duo (posture only rearranges the route and focus);
PRODUCT.md principles 3 and 5; product-design `rule/remote-is-normal` and
`rule/design-reachable-states`. This is a behavior re-check, not native visual
or accessibility acceptance.

## Ranked remaining findings

### R1. P1 regression: an old posture's Send acknowledgement erases the new draft

Locations: `apps/mobile/src/constellation/composer.tsx:26`, `:35–38`;
`apps/mobile/src/constellation/ConstellationScreen.tsx:258`;
`apps/mobile/src/duo/ConstellationSpan.tsx:269`;
`apps/mobile/src/duo/DuoShell.tsx:168`.

Verified with the real LeadComposer and kept store in a temporary React render,
native controls replaced at the boundary. Send A in the unfolded sheet and hold
its acknowledgement. Fold, then type B into the rail's composer. Its local
`sending` is false, although A still waits. A's old success callback calls the
shared `setText("")`, erasing B. The probe observed B in `leadDrafts`, then an
empty draft after A's acknowledgement. The new composer also offers Send for A
again while the first Send waits. Sharing only the text introduced the destructive
cross-view callback; the old local state did not clear the other view's draft.

Smallest fix: share the in-flight lead submission and draft generation per
Host/Constellation, and clear only the generation acknowledged. Both arrangements
must observe the same pending Send. Source: DESIGN.md, iPhone Duo;
`rule/remote-is-normal`. Finding 4 remains partial.

### R2. P2 remaining: Review's retry identities disappear on remount or pane handoff

Locations: `apps/mobile/src/review/useSubmissions.ts:21`;
`apps/mobile/src/duo/ContextPane.tsx:127`;
`apps/mobile/src/review/ReviewScreen.tsx:49`;
`apps/mobile/src/duo/DuoShell.tsx:143`.

Verified by rendering the real useReviewSubmissions hook across a remount, with a
fake dispatch returning a lost-answer failure. Ask to fix in ContextPane, lose
the answer, then open Review and retry; alternatively fold and unfold the pane.
Each mounted caller owns a different `reviewSubmissions()` instance. The probe
recorded two commands with different command and feedback-comment IDs for the
same subject, action and payload. The first may already have landed. Same-mount
double taps and retries are fixed; the subject's operation does not survive the
view that initiated it. No duplicate accepted feedback Turn on a real Daemon is
claimed.

Smallest fix: keep Host/subject/action slots above these surfaces, shared across
ContextPane and ReviewScreen and their remounts for the running app. Preserve
ambiguous IDs and pending state. Source: `rule/remote-is-normal`; original
finding 9's stable-retry requirement. Finding 9 remains partial.

### R3. P2 remaining: New session does not release dictation before Start

Locations: `apps/mobile/src/newSession/NewSessionForm.tsx:283`, `:290–314`;
compare `apps/mobile/src/thread/ThreadScreen.tsx:393–404`.

Source-verified integration gap; consequence inferred, not microphone-tested.
Start while dictating and delay or lose the reply. Start captures one prompt,
but the live mic keeps updating the editable prompt while that command waits.
A retry can therefore capture a different prompt/generation; a snapshot during
the asynchronous draft clear can also write into the just-cleared field before
unmount. Thread Send/Queue now call `voice.release()` before consuming the field;
New session never does. DF2 disclosed this omission. Re-anchoring preserves edits
but does not end ownership when Start takes the prompt.

Smallest fix: release dictation before Start captures its prompt, using the same
ownership boundary as ThreadScreen. Source: DESIGN.md, typed-first Mobile App
continuity; original finding 7 explicitly includes the New session prompt.
Finding 7 remains partial.

## Verdict per original finding

| Finding | Verdict | Evidence / remaining limit |
| --- | --- | --- |
| 1 — replacement Claim inherits choice/answer | Fixed | `constellation/claim.tsx:159–161` derives unsent state from Attempt/revision/head; `unsent.test.ts` covers each replacement identity. Outbox lookup selects the current Claim's delivery. |
| 2 — ContextPane hides Critical cards | Fixed | `duo/ContextPane.tsx:147` always supplies contextRows to DiffList; `contextRows.test.ts` covers missing/failed/loading diffs. `duo/useSessionContext.ts:151` captures diff failure as a result and retains the separately read summary. Hook not rendered in this re-check. |
| 3 — graph off portrait display / inaccessible columns | Fixed in source | `duo/arrangement.ts:47` retains the rail for a horizontal fold; graph tests cover that input. `ConstellationSpan.tsx:213–218` now uses horizontal scrolling with explicit content width. Native scroll sizing/gestures remain unverified. |
| 4 — posture loses unsent constellation input | Partial | `duo/kept.ts:36–45` shares text and Claim choices; `kept.test.ts` covers the store/arrangement sequence. R1 breaks pending-Send continuity. Separate useConstellation/useVerdicts calls remain in both views; focus/selection is not shared or verified. |
| 5 — released queued follow-up loses retry path | Fixed | `thread/controller.ts:210–221` counts the operation busy until success/re-queue; `busy()` includes it. The real controller/registry regression test passes after dropping the answer with the screen lease released. |
| 6 — Send acknowledgement clears newer attachments | Fixed | `thread/ThreadScreen.tsx:395–404` takes a submission snapshot; `composer/attach.ts:162–166` removes only its chip keys. Attachment tests cover staged and still-staging newer chips. |
| 7 — voice overwrites edits / restores submitted text | Partial | `composer/mic.ts:68–75` re-anchors against current text and guards ownership; ThreadScreen releases on Send/Queue. Mic/voice tests pass. New session is still missing the consumption boundary (R3). |
| 8 — rapid taps create multiple dictations | Fixed at tested boundary | `composer/mic.ts:116–123` claims ownership before awaiting permission; release and callbacks check operation ownership. Tests cover pending permission, late callbacks, and cleanup. Native audio startup/teardown remains unverified. |
| 9 — duplicate Review feedback / fresh retry IDs | Partial | `review/submissions.test.ts` passes for same-instance double tap, ambiguous retry, refusal and success. ReviewScreen and ContextPane both use slots and show failures, but independent mounted instances lose continuity (R2). |
| 10 — Send weight / linked-device copy | Fixed | `thread/Composer.tsx:302` uses 500; `thread/ThreadScreen.tsx:275` says “This host isn't linked to this iPhone”. Source verified. |

## Checks and limits

- Only mobile tests were invoked. `bun run --cwd apps/mobile test`: **307 pass,
  1 skip, 0 fail**, 553 expectations across 50 files, outside the sandbox.
  The skip is the standalone Hermes VM.
- Initial sandbox run: 280 pass, 1 skip, 12 fail. Setup failed on loopback
  listeners (`EADDRINUSE` for port 0) and the Swift compiler's denied cache path,
  with dependent teardown errors. The same mobile command passed on retry
  outside the sandbox; no test code or expectations were changed.
- `bun test apps/mobile/dv-review.probe.test.tsx`: **2 pass, 0 fail**, seven
  expectations. Temporary probes used already installed React DOM/happy-dom,
  the real LeadComposer/kept store and useReviewSubmissions, with native controls
  and dispatch faked at boundaries. They assert the observed bugs, not fixes.
  The probe was removed before commit; no dependencies were added.
- These results are Reported command evidence. No Daemon command-item references
  are invented. No typecheck, standalone lint, root suite, benchmark or native
  smoke was run. Git commit hooks may perform their required document checks.
- No simulator/device, hinge gesture, real microphone/transcription, native
  focus/selection, real feedback/approval or visual parity check was performed.
  Horizontal native scrolling is a verification gap, not a proven new bug.
- Final changed path: this report. No Area paths were declared. The temporary
  mobile probe path above was also outside the declared Area and is removed.
