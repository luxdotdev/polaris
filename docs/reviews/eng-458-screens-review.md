# ENG-458 screens adversarial review

Reviewed merged Lead head `73d902b923a6893cd93ddef687ada0c7d463aaf4` on SV.
Scope: S1–S5 and S7, against DESIGN.md's Mobile App section and Do's and Don'ts,
CONTEXT.md, and Paper's Mobile page (H4, M4–M7, C2, W1/W2).
No product code was changed. Locations below refer to the reviewed head.

## Findings

### 1. P1: long permission requests lead to a screen that cannot answer them

Locations: `apps/mobile/src/home/ui/ApprovalActions.tsx:60`,
`apps/mobile/src/thread/ThreadScreen.tsx:230`,
`apps/mobile/src/thread/composer.ts:51`, `apps/mobile/src/thread/rows.ts:21`.
Verified in the model and screen code; the seeded simulator Home displays the redirect.

A command past 280 characters or four lines has no inline approval buttons. Home
says "Review it in the agent session" and opens the thread. The thread never renders
`pendingApprovals`: its rows cover messages, tool steps and errors, and its composer
is disabled with "Answer the request above to go on". There is no request above and
no Approve or Deny. A user cannot finish the primary needs-you action from the phone.
Multiple-question requests likewise lose their structured questions in this destination.

Smallest fix: render the actual pending requests in the thread, including complete
permission detail and structured question answers, using their session/request IDs.
Exercise the long-command Home → thread → resolve path against a test Daemon.
Source: DESIGN.md, Mobile App/Home; `rule/design-reachable-states` and
`rule/long-content-survives` in the product-design skill.

### 2. P1: a send acknowledgement deletes text typed after Send

Location: `apps/mobile/src/thread/controller.ts:218` (clear at `:188`).
Verified through `openThread` with a held dispatch acknowledgement.

Send message A, type draft B while the Host is answering, then let A succeed.
`clearSent()` calls `type("")` on the current composer, rather than clearing the
submitted draft only. The reproduced composer became empty and its draft was
flushed empty. Remote latency makes this an ordinary interaction, and continuity
can propagate the deletion to the Desktop App.

Smallest fix: capture an edit generation with the submitted text; clear only if that
generation is still current. Retain and save any intervening text. Add a held-ack
regression with new typing before success. Source: DESIGN.md, Mobile App/Continuity;
`rule/remote-is-normal`.

### 3. P1: reconnect destroys the thread controller and its queued follow-ups

Location: `apps/mobile/src/thread/ThreadScreen.tsx:44` and `:49–60`;
queue storage at `apps/mobile/src/thread/controller.ts:197`.
Verified controller recreation loses the queue; the connection-triggered cleanup is
verified by code inspection, not a native disconnect gesture.

`ready` becomes false whenever the Host disconnects. Because it is an effect
dependency, React disposes the existing controller and sets it to null. A reconnect
creates a new controller whose queue is empty. The reproduction queued a follow-up,
disposed/recreated the controller, and observed `[]`. The same cleanup also replaces
the last known transcript with "Connecting…" instead of keeping it dimmed. The
resumable source already knows how to wait through a lost connection, so this screen
lifecycle defeats that behavior.

Smallest fix: keep the controller after its first live connection, keyed to Host and
session identity rather than current liveness. Show Connection State around the
retained transcript; ensure queued messages survive reconnect and deliberate navigation.
Source: `rule/remote-is-normal`; DESIGN.md, Continuity and composer follow-ups.

### 4. P1: tapping a working session opens Review instead of its composer

Location: `apps/mobile/src/home/HomeScreen.tsx:107`;
predicate at `apps/mobile/src/home/model/lines.ts:32`.
Verified with a first-turn working fixture: label `Working · turn 1`, predicate `true`.

`hasUnreviewedTurns` compares total turns to the accepted index without checking
Session State. A first Turn already increments `turnCount`, so every ordinary working
session with unaccepted work opens Review. With only a working Turn, Review says
"The diff shows when this turn ends"; with earlier Turns, it opens an older Review.
Neither destination exposes the live thread's Steer, Queue or Stop. Failed, limited
and dormant sessions can take this route too, despite their row not saying "Ready to
review".

Smallest fix: reserve the Review destination for the exact ended/ready-to-review row
state, or give the row a separate Review action while its primary action opens the
thread. Test destination selection for each Session State. Source: DESIGN.md,
Mobile App/Home and Suggested actions; `rule/design-reachable-states`.

### 5. P1: Accept becomes available before the Risk Summary is known

Location: `apps/mobile/src/review/ReviewScreen.tsx:75`;
`apps/mobile/src/review/model.ts:75`.
Verified through `acceptState` and the actual inputs the screen supplies.

Loading and failed summaries both become `summary === null`, then `findings: []`.
As soon as an ended Turn loads, Accept is ready, including while the reviewer is
still running or after a risk-load error. A later Critical result pauses it only
if the user has not already accepted. The same problem exists for an in-progress
summary whose Critical finding has not arrived yet. AcceptTurns does not enforce
the phone's Critical-finding policy on the server.

Smallest fix: represent loading, failed and incomplete risk evaluation explicitly in
Accept state; keep Accept unavailable until the reviewed subject's required risk
results are known, and show the reason. Test delayed Critical results and failed
risk loads. Source: S3 brief, "Accept is paused while a Critical finding is open";
DESIGN.md, Review and Mobile App.

### 6. P1: Critical cards disappear when their file is absent from the parsed diff

Location: `apps/mobile/src/review/diffRows.ts:213`;
error path at `apps/mobile/src/review/ReviewView.tsx:196`.
Verified through the real parser and row builder; the error branch is code-inspected.

`diffRows` iterates only parsed files. A Critical finding for a path missing from
that patch has no row, even though the summary tally still says one critical and
Accept is paused. The reproduction used a real one-file patch plus a Critical on a
different path: tally 1, visible finding cards 0. This can arise with path mismatch,
a finding outside the patch, or partial/empty diff data. If git.diff fails altogether,
ReviewView replaces the whole finding-bearing list with an error string, also hiding
every Critical card and its remediation action.

Smallest fix: render unplaced findings independently of parsed files, and keep them
available when the diff fails. Add missing-file, empty-patch and failed-diff cases;
the existing unplaced-line test covers only a file already present in the patch.
Source: DESIGN.md Don'ts, "let anything hide or dim a Critical Finding"; S3 brief.

### 7. P1: Accept can record approval but permanently lose the answer to the lead

Location: `apps/mobile/src/constellation/verdict.ts:62` and `:75`;
`apps/mobile/src/constellation/model.ts:124`.
Verified against a real, isolated test Daemon with a seeded handed-up Claim.

Accept is two RPCs: Approve, then message the lead with the answer. I let the real
Approve succeed and failed only the message call at the transport boundary. The
Claim remained approved with no OperatorMessage. Once the approval event refreshes
the view, `isHanded` becomes false and removes the reply UI, including the error and
retry path. The Claim can reach the lead through its Approved notification while the
user's product decision is lost. The existing verdict test checks only a refused
Approve and cannot catch this partial success.

Smallest fix: persist the verdict and answer as one operation, or use an idempotent
outbox that survives the handed-up row disappearing and retries the message after
approval. A pending answer must remain visible until delivered. Test loss between
the two calls and reconnect. Source: DESIGN.md, Mobile App/Constellation: the verdict
reaches the lead with the answer; `rule/remote-is-normal`.

### 8. P2: repeated submissions generate independent side effects

Locations: `apps/mobile/src/thread/controller.ts:201`,
`apps/mobile/src/constellation/claim.tsx:140`,
`apps/mobile/src/constellation/verdict.ts:75`;
also `apps/mobile/src/review/ReviewScreen.tsx:94`.
Verified for overlapping thread submissions and repeated successful Claim Accept.

The thread allows a second submit while the first is unresolved; the reproduction
observed two SendTurn commands with the same prompt. Each dispatch gets a fresh
command ID. A handed-up Claim uses React state to disable controls after rendering,
with no synchronous guard, and a repeated verdict uses fresh message IDs. Sending
the same displayed Claim Accept twice to the test Daemon queued two identical lead
messages, even though approval itself was idempotent. "Ask … to fix" similarly sets
Sent only after success, so it has no in-flight protection. Daemon validation may
reject a second Turn, but that is not a guarantee of one user action or one message.

Smallest fix: latch each logical submission synchronously, retain its command IDs
through retry, and release it on a defined outcome. Bind Claim state to Attempt,
Claim revision and head. Test keyboard-submit plus button-submit before an ack,
and message retries after ambiguous transport results. Source: SV action-safety brief.

### 9. P2: the Review tab and the thread's Open review action are unfinished routes

Locations: `apps/mobile/src/app/routes.tsx:63` and `:43`;
`apps/mobile/src/App.tsx:69`;
`apps/mobile/src/thread/ThreadScreen.tsx:241`.
Verified by code inspection and comparison with Paper H4/M4.

The Review tab is just a heading and its count is fixed at zero. Meanwhile ThreadRoute
never passes `onOpenReview`, so a completed Turn's state-implied Open review chip is
always filtered out. A session opened through a widget or immediately after Start
cannot move directly from its conversation to Review. Home offers a separate route,
but the two prominently advertised entry points do not work.

Smallest fix: wire the thread's callback to the session Review route and populate
the Review tab from ready sessions, including loading/empty/offline states. Source:
DESIGN.md, Mobile App/Suggested actions; Paper H4 and M4.

### 10. P2: with no ready Harness, the sheet hides the reason and any recovery path

Location: `apps/mobile/src/newSession/NewSessionForm.tsx:135`;
filter at `apps/mobile/src/newSession/harness.ts:26`.
Verified by following the loaded/no-ready branch; no native sign-in was attempted.

When every Harness needs sign-in, `choice.harness` is null and HarnessValue becomes
non-interactive "No harness is ready on this host". The picker containing the
sign-in labels cannot be opened. Missing and too-old Harnesses are filtered out
entirely. The user cannot learn which Harness needs attention or what to do on the
Mac, and Start is disabled. This is a reachable v1 state, not a request to implement
phone-side browser sign-in.

Smallest fix: keep Harness availability reachable without a selection, show each
reason and the concrete Mac-side remedy, and offer a refresh. Remote authentication
may remain a Mac task. Source: DESIGN.md, New session's none-ready state and S5's
requirement to reuse those rules; `rule/design-reachable-states`.

### 11. P2: Home mounts every needs-you and working row, including their live feeds

Location: `apps/mobile/src/home/HomeScreen.tsx:158` and `:169`;
`apps/mobile/src/home/ui/constellationProgress.ts:9`.
Verified architecture; device performance impact is inferred, not measured here.

Home uses ScrollView plus map for unbounded needs-you and working sections. Every
constellation row also opens its own subscription and status/lead refresh path,
even far outside the viewport. Recent is capped, but the active lists are not.
A Host with hundreds of active sessions or constellations creates all native rows
and keeps all these observers alive. The 2,000-line diff bench says nothing about
this Home workload.

Smallest fix: use a virtualized section list and separate task-count summaries from
per-row full constellation following; measure a large active Home on Hermes. Source:
AGENTS.md Performance; PRODUCT.md's several-Host supervision requirement.

### 12. P2/P3: state colours and one type weight violate the canonical rules

Locations: `apps/mobile/src/home/HomeScreen.tsx:186`,
`apps/mobile/src/home/ui/rows.tsx:97`,
`apps/mobile/src/thread/Composer.tsx:278`,
`apps/mobile/src/thread/ThreadScreen.tsx:222`.
Verified in code and the rendered Home; P2 colour semantics, P3 weight/copy.

Home uses Starlight for the Working heading and for accepted task segments, instead
of reserving it for the four brand uses. Done task segments should use `accepted`,
as C2 already does. The send arrow explicitly uses weight 600, despite the 400/500
rule. A missing Host says "isn't paired", though the phone is a Linked Device and
Pairing is an Extension's concept.

Smallest fix: use neutral section chrome, accepted task colour, weight 500, and
"isn't linked to this iPhone". H4's colour choice does not override the
written `rule/starlight-is-rare` and `rule/constellation-colour`. Sources: DESIGN.md
Typography and Do's and Don'ts; CONTEXT.md, Linked Device and Pairing.

## Evidence and limits

- Mobile suite: **160 pass, 1 skip, 1 fail** (162 tests, 23 files). The only failure
  is the known newSession plan-mode observer test assigned to S8; it is excluded
  from these findings. The skip is the unbuilt standalone Hermes VM. No repo-wide
  suites were run. The initial verdict invocation was blocked by sandbox loopback
  access; the native retry passed **3/3**.
- Successful Accept: seeded a handed-up review Claim with real Constellation decider
  events committed through EventStore in a disposable test Daemon, then used the
  real dev bridge and `sendVerdict`. The RPC approved the correct Attempt and sent
  the answer. Repeating the same displayed verdict queued two messages. A separate
  test Daemon dropped only the second RPC and retained approval with no message.
  These fixtures do not approve any real Constellation work.
- The focused controller probes used the existing fake Host at the RPC boundary
  and the real controller/source. They held acknowledgements, recreated the
  controller, and printed command/text/queue outcomes. The Review probe used the
  real patch parser and row builder. These are behavior probes, not copied
  implementation assertions or mock-called-only tests.
- The existing tests inspected generally assert real derived output or observable
  Daemon outcomes. I found coverage holes listed above, not a separately substantiated
  tautological-test finding. The verdict test's title/README overstates successful
  Accept coverage: its Accept fixture names a nonexistent Attempt.
- Simulator: used only shared iPhone 18 Pro
  `01500F31-0D59-49B4-97FA-26DC85D4C828`. One non-clean prebuild and Debug build
  succeeded with the widgets extension. The app ran on Hermes through the isolated
  dev bridge: populated Home, 12 workspace chips, a two-line title, short permission
  actions and the long-command redirect were observed. Screenshots were compared
  with Paper H4/M4/M5/C2/W2; no pixel-perfect parity claim is made.
- Deep-link verification is pending the iOS system Open confirmation. `simctl openurl`
  reached "Open in Polaris?", not the destination. The available CUA app surface could
  not access Simulator, and no simulator tap connector is exposed. Cold and warm
  route checks, Back to Home, closing New, and resetting the Review tab are not yet
  claimed as passed.
- No physical device, 120 Hz native fling, Home load profile, Reduce Motion toggle,
  light theme/density matrix, or real home/lock-screen widget placement was checked.
  Native diff scroll numbers in S3's Claim remain reported dependency evidence,
  not measurements rerun by SV.

## v1 scope judgments

The effort picker can be deferred: M6 does not show one, Start sends the Host default,
and it does not block starting or supervising a session. Native Harness sign-in can
also remain on the Mac in v1, but the none-ready diagnostic/remedy in finding 10 is
needed. Attach and voice belong to S8 and are not findings here. The known plan-mode
red test is also S8's. Syntax/word emphasis, the colourblind setting, live lead-session
following and user-question reply UI remain disclosed dependency gaps; this review
has not silently treated them as delivered.
