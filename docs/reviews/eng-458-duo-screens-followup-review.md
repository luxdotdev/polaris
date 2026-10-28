# ENG-458 Duo, screens fixes and composer adversarial review

Reviewed lead head `a67e413c848ef4d372f4e36690c7e79c891a6fe7` on S6V.
The lead branch still named this head at the end of the review. Scope: S6, SF1–SF5,
S8, and findings 1–13 of `eng-458-screens-review.md`. No implementation fixes.
Result: seven P1 findings, two P2 findings and one remaining P3 finding.

The job is to answer Needs You, judge a Claim or Turn, and continue a conversation
on the right Host without losing input when the connection or posture changes.
The Daemon owns mechanical state; choosing Accept remains the user's decision.
Sources: DESIGN.md, Mobile App and iPhone Duo; PRODUCT.md principles 3 and 5;
CONTEXT.md; product-design's `rule/remote-is-normal` and
`rule/design-reachable-states`. This is an integrated behavior review, rather
than a standards-only diff review (the assigned base is already the lead head).

## Ranked findings

### 1. P1: a replacement Claim inherits an earlier Claim's Accept choice and answer

Locations: `apps/mobile/src/constellation/claim.tsx:151`, `:169` and `:81`;
`apps/mobile/src/constellation/ConstellationScreen.tsx:178`;
`apps/mobile/src/constellation/rows.tsx:161`.
Verified with the real `HandedClaimActions` rendered through React, with native
controls replaced at the boundary. No real Claim was approved.

Choose Accept on head 1 and type its answer. Replace the handed-up Claim with a
new revision/head on the same Task while the control stays mounted, as can happen
when the Client catches up after a connection gap. The row is keyed only by Task
id. Neither `step` nor `Reply`'s `draft` is keyed to the Claim. The rendered header
changes to head 2, but Accept remains selected with the answer for head 1. Return
submits Accept for head 2 without choosing a verdict on that Claim. The probe
changed both Attempt and revision and observed the new Claim submitted with
`reply: "answer for head-1"`.

The outbox binds a submitted delivery correctly; the unsent decision before it
does not. This leaves finding 8's Claim-binding requirement incomplete.
Smallest fix: key/reset the unsent choice and reply by Attempt, revision and head,
while keeping already-submitted deliveries separately bound to their old Claim.
Source: screens finding 8; DESIGN.md, Constellation; user decision authority.

### 2. P1: the Duo context pane hides Critical cards when the diff cannot show them

Locations: `apps/mobile/src/duo/ContextPane.tsx:155`, `:212` and `:237`;
`apps/mobile/src/duo/useSessionContext.ts:155`.
Verified by rendering the real `ContextPane` with a Critical finding and boundary
data for an empty patch and a failed diff.

Tap a Critical finding whose path is absent from the patch. `diffRows` can now
produce its unplaced card, but `fileProblem` replaces the entire `DiffList` with
"This file has no changes left in this turn's diff." A failed diff similarly
leaves only its error. The header still names the finding; the Critical card,
reason and Ask to fix/verdict controls disappear. These are exactly the two
states SF2 fixed in Review. Also, `Effect.all` couples summary loading to diff
success, so a diff error discards the summary read for an earlier focused Turn.

Smallest fix: retain findings independently of diff success and render the
problem as a note alongside the focused finding's card, using the same fallback
as `reviewRows`. Do not replace the card-bearing list on the error/missing-file
branch. Source: DESIGN.md, nothing hides or dims a Critical Finding; original 6.

### 3. P1: the unfolded graph can place every Task outside the supported portrait display

Locations: `apps/mobile/src/duo/graph.ts:103`;
`apps/mobile/src/duo/ConstellationSpan.tsx:196` and `:206`;
`apps/mobile/src/duo/arrangement.ts:45`; `apps/mobile/app.json:8`.
Verified through `postureOf` → `arrangementOf` → `graphLayout` with synthetic
reports using the existing posture tests' inner-display sizes. Not seen natively.

The app is portrait-only. For a fully-open 669×951 report with horizontal division
`{x:0,y:455.5,width:669,height:40}`, posture becomes unfolded and Constellation
selects span. The graph treats that horizontal region as a vertical x exclusion:
even A1 goes to x=689 on a 669pt screen. The Claim is also forced to the right of
that exclusion. The original rail is hidden, leaving no visible Task or Claim
action. This is a broken portrait rendering path, beyond the disclosed absence
of landscape support.

Even with a vertical division on the 951pt layout, five sequential dependency
columns produce x=959.5 for the last node and width=1169.5. The ScrollView scrolls
vertically only and never sets the calculated content width, so deeper columns
are inaccessible.

Smallest fix: carry the fold axis through the span layout and keep the existing
rail available for unsupported axes; size and scroll the graph in both axes (or
fit it to the viewport). Test a horizontal fully-open report and more columns
than fit. Source: DESIGN.md, iPhone Duo; `rule/design-reachable-states`.

### 4. P1: folding switches Constellation composers and destroys the unfolded draft

Locations: `apps/mobile/src/duo/DuoShell.tsx:168`;
`apps/mobile/src/duo/ConstellationSpan.tsx:244`;
`apps/mobile/src/constellation/composer.tsx:20`.
Verified by component/state ownership inspection; no native hinge gesture.

Unfolding hides the mounted ConstellationScreen and mounts a new
ConstellationSpan with another LeadComposer. Each owns its own `useState("")`.
A folded draft disappears from view on unfold. A draft typed in the unfolded
sheet is unmounted and lost on fold; unfolding again starts it empty. The same
split applies to an unsent Claim reply, and unfolding also starts a second
constellation subscription rather than rearranging the existing view.

Smallest fix: keep one composer and unsent Claim state above both arrangements,
keyed by Host/Constellation and Claim identity, or rearrange the same mounted
controls. Test folded → unfolded → half-folded → folded with input and selection.
Source: DESIGN.md, posture never navigates and focus stays; S6 transition brief.

### 5. P1: a queued follow-up loses its retry path after the screen lets go

Locations: `apps/mobile/src/thread/controller.ts:208` and `:160`;
`apps/mobile/src/thread/threads.ts:37`.
Verified through the real controller, registry and effect/rpc source over the
existing fake Host.

Queue one follow-up during a working Turn, release the screen's lease, then let
the Turn end. `sendFollowUp` publishes an empty queue before `send` registers an
in-flight command. The registry sees no lease and `busy() === false`, removes
the controller and disposes its feeds. If dispatch fails, the follow-up is put
back on that orphaned controller. Reopening gets a new empty controller. The
probe dropped the answer after dispatch: `made:2`, `same:false`, the old queue
held the follow-up and error, and the new queue was `[]`. A failure before
delivery would lose the user's intended next Turn; an ambiguous result loses
the retained id and visible retry state.

There is another idle publication in `send.finally`, before the caller restores
the queue on failure. Moving only the first `set` is therefore insufficient.
Smallest fix: count the whole follow-up operation as busy until success or
re-queue is committed, and publish those changes atomically before allowing
registry disposal. Source: original 3; `rule/remote-is-normal`.

### 6. P1: acknowledging Send deletes attachments added for the next message

Locations: `apps/mobile/src/thread/ThreadScreen.tsx:392`;
`apps/mobile/src/composer/attach.ts:154`.
Verified through the real controller and attachment store, composing the same
success callback as ThreadScreen, with a held effect/rpc acknowledgement.

Send text A with attachment A, type text B and attach B before A is acknowledged.
The SF1 generation check correctly retains text B. The screen nevertheless calls
`attachments.clear()` on success, clearing both A and B. Probe output before ack:
`["A","B"]`; after ack: `text:"next message", chips:[]`; the sent command carried
only `att-A`. Attach remains usable while a Send waits. S8's duplicate-Send guard
protects against a second submit clearing chips, not the first submit's ack.

Smallest fix: capture the submitted chip keys and remove only those on success;
preserve chips added or replaced afterward, including uploads still staging.
Source: original 2's input-preservation requirement; DESIGN.md, Attachments in the
composer and Mobile App continuity.

### 7. P1: voice snapshots overwrite edits and restore text after Send

Locations: `apps/mobile/src/composer/useVoiceInput.ts:52–56`;
`apps/mobile/src/thread/Composer.tsx:170` and `:201`.
Verified with the real hook in a React render, faking only the audio/transcription
and Host boundaries. No microphone or Deepgram service was used.

Each transcript snapshot calls `onText(withHeard(typed, heard))` using the text
captured when dictation began. The field remains editable, and Send/Queue remain
enabled while listening. Correct or append text during dictation: the next
snapshot replaces that edit. Send the current text: a later interim/final
snapshot repopulates the cleared composer with the already-submitted prefix
and transcript. This affects ordinary iPhones and the New session prompt too.
The rendered probe lost `handwritten correction` on its next snapshot; after
clearing the field it returned to `typed prefix spoken next final`.

Smallest fix: track the dictated range against the current edit generation,
preserve intervening user edits, and define finish/cancel before Send or Queue
consumes that generation. Late snapshots must not recreate submitted text.
Source: S8, typed-first dictation; original 2; Mobile App continuity.

### 8. P2: rapid mic taps start two dictations and cleanup cancels only the last

Locations: `apps/mobile/src/composer/useVoiceInput.ts:41`, `:55`, `:74` and `:87`.
Verified in the same real React hook probe, holding the permission promise.

Two taps before permission/audio setup resolves both see `dictation.current ===
null` and enter `begin`. Both continuations open a Host dictation and start the
same audio stream; the second overwrites the ref. Audio buffers and Stop now
target only the second dictation. Unmount cancels only that one, leaving the
first Host operation until it independently ends or fails. Its callbacks can
also clear the ref or stop audio belonging to a later operation. Observed:
two dictations, two starts, one cancellation on cleanup.

Smallest fix: synchronously latch a starting/recording/finishing operation before
the first await; invalidate it on cleanup or target change, and let callbacks
mutate state only if they still own that operation. Source: S8 lifecycle and
screens finding 8's one-logical-submission requirement.

### 9. P2: Review still sends duplicate feedback with fresh command ids

Locations: `apps/mobile/src/review/ReviewScreen.tsx:94` and `:105`;
`apps/mobile/src/review/actions.ts:30`;
`apps/mobile/src/duo/ContextPane.tsx:172`.
Verified by rendering the real ReviewScreen with a held dispatch boundary.

Tap Ask to fix twice before its first ack. There is no synchronous latch; Sent
is set only after success. The probe observed two `SendFeedback` commands with
different command ids and different feedback-comment ids for the same finding.
A retry after a lost answer also gets fresh ids. The new Duo context pane
duplicates that path and additionally has no rejection handler. Verdict thumbs
and Review Send back have no shared submission slot either. SF1/SF4/Start
latching did not complete the Review part of original finding 8.

Smallest fix: a submission slot per reviewed subject/action, synchronous guard,
stable command and comment/verdict ids through ambiguous failure, and visible
retry/error state. Reuse it in ContextPane. The probe establishes duplicate
RPC submissions, not two accepted feedback Turns on a real Daemon.
Source: original 8; `rule/remote-is-normal`.

### 10. P3: original finding 13's thread weight and glossary copy remain

Locations: `apps/mobile/src/thread/Composer.tsx:302`;
`apps/mobile/src/thread/ThreadScreen.tsx:274`.
Verified in source. Send still explicitly sets weight `600`, and a missing Host
still reads "This host isn't paired". Home's colour changes did land, but those
two portions were left outside SF3's Area and remain in the integrated head.
Smallest fix: use weight 500 and "This host isn't linked to this iPhone".
Source: DESIGN.md, Typography; CONTEXT.md, Linked Device and Pairing; original 13.

## Disposition of the original 1–13

| Original | Integrated result |
| --- | --- |
| 1 | Pending permission cards show complete detail and controls; structured questions have per-question choices. Main composer still supplies own-words answers. The full native Home → thread → resolve path was not rerun. |
| 2 | Text generation fix passes; new attachment and dictation paths still lose input (6, 7 above). |
| 3 | Connected screen retains its controller; released queued work has a disposal race (5 above). |
| 4 | Fixed in destination selection and Session State tests. |
| 5 | Loading, running and failed risk states pause Accept; delayed Critical tests pass. Daemon enforcement remains dependency-disclosed server work. |
| 6 | Fixed in Review's row builder; Duo context reintroduces hidden cards/actions (2 above). |
| 7 | Outbox preserves partial approval/message delivery within the running app. Restart persistence remains SF4's disclosed follow-up; no app-kill test here. |
| 8 | Thread, Start and submitted Claim delivery latch; unsent Claim identity and Review remain incomplete (1, 9 above); new mic startup also races (8). |
| 9 | Review tab, count and thread Open review route are implemented. No native navigation check here. |
| 10 | None-ready Harness reasons, Host remedies and Check again are implemented. Failed availability-load retry remains SF3's disclosed gap. |
| 11 | Home is virtualized and constellation feeds depend on visibility. Model/feed tests pass; no Hermes Home load measurement. |
| 12 | Widget navigation selects Sessions and closes New for both delivery paths; tests pass. No actual widget tap. |
| 13 | Home colours fixed; thread weight/copy still open (10 above). |

SF5's shared store owns one Host feed and diffs connection identity; its tests
pass. The Duo thread context leases SF1's existing controller. Constellation's
second mounted view does not share that same arrangement/state approach.

## Evidence and limits

- `bun run --cwd apps/mobile typecheck`: passed.
- `bun run --cwd apps/mobile test`: native retry passed **271 pass, 1 skip,
  0 fail** across 42 files, 460 expectations. The skip is the standalone Hermes
  VM. Initial sandbox run: 244 pass, 1 skip, 12 failures from loopback socket and
  Swift cache restrictions; those are environment failures, not product findings.
- Mobile-only lint: `bun run quality --check` over tracked mobile TS/TSX, JSON,
  Swift and Markdown files passed. No repo-wide suite or lint invocation.
- Temporary probes exercised the real registry/controller/source and chip store;
  pure posture/arrangement/graph; and real React rendering for Claim replacement,
  Review duplicate submission, ContextPane fallbacks and the voice hook. React
  DOM/happy-dom were already installed; no dependencies were added. Native views,
  audio/transcription and Host calls were faked at their boundaries. These are
  not native layout, microphone, real approval or Deepgram results.
- Probes were removed before committing. Their observations and reproduction
  steps are recorded above. Shell results are Reported evidence; no Daemon
  command-item references are invented.
- No simulator was created, booted, changed or deleted; no generated `ios/`
  directory was created. Open/half-open postures were **not seen on screen**.
  The operator offered FE4F81F1 with a human controlling DeviceHub; this review
  proceeded from code/tests, without requesting that intervention.
- Native bridge lifecycle/threading was inspected: `current` runs on the main
  queue, observation attach/detach dispatch to it, the probe removes its interaction
  and view, and the JS subscription removes its listener. No separate proven
  threading bug is claimed. No hinge build, native listener teardown, foreground
  transition or on-device orientation test was performed.
- Non-Duo posture inputs fall back to folded and optional thread seams keep their
  defaults. No physical ordinary iPhone run, keyboard/fold-region screenshot,
  focus/selection transition test, native attachments picker, microphone permission
  prompt, Home performance profile or visual parity check was performed. The
  ordinary-phone input bugs above do not depend on Duo hardware.
- The known cover-display status cluster covering Home's Hosts pill was excluded
  as instructed; it is already a follow-up. S6's disclosed Reply focus, landscape,
  graph styling and S8's native smoke limits are not presented as newly found bugs.
