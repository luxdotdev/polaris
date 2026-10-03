# @polaris/spec

A formal model of how Polaris turns commands into committed events and how every Client comes to see exactly those events, written in [Quint](https://quint-lang.org) (TLA+ semantics, checked with Quint's simulator and with Apalache). Linear: ENG-209.

It covers the event store's group commit, receipts and gapless sequence (`apps/daemon/src/store/EventStore.ts`), the live hub's bounded subscribers (`store/hub.ts`), the Engine's streams and recovery rule (`apps/daemon/src/engine/streams.ts`, `recovery.ts`), approvals, Archive and late Harness reports (the session machine, `engine/session.ts`), accepting Turns and the review-only events (M2 Review, ENG-217), and the Client's resumable feeds (`packages/client/src/resume.ts`). The same properties are tested against the real code by the model-based tests in `apps/daemon/src/verification/`.

| File | What |
|---|---|
| `file-edits.qnt` | X1 regular-file reversible move: durable intent, exact owned/absent versions, restart reconciliation, reverse intent and idempotent retry. Runtime checkpoint projection and ordered-chain filesystem fault tests accompany it. |
| `languages.qnt` | M3.1 contract-only model: isolated contexts, queue/version/generation fences, durable edit acknowledgment and guarded undo. Future T1/X1 runtime adapters must emit observed traces; P1 installs no runtime. |
| `polaris.qnt` | The model, its properties, and its instances: `current` (the code as it is), `review` (the code as it is, with Clients also accepting Turns and recording Verdicts, in one session), `finding1` … `finding4` (the code before each finding's fix, kept as mutants that must still violate `safety`) and `small` (for Apalache). |
| `polaris_test.qnt` | Scenario tests: interleavings written out by hand (group commit, retry after a crash, answer races, withdrawal races, restart, a dropped subscriber, the host feed, Archive, late approval requests, accepting Turns, Verdicts off the host stream), and one per finding against its mutant. |
| `scripts/check.ts` | Runs every check (`bun run spec`). |
| `scripts/replay.ts` | Trace validation: replays logs the real Engine committed through the model (below). |

## Running it

```sh
bun run spec                                       # typecheck, scenario tests, simulator (~45 s)
bun run spec -- --samples 20000                    # a longer simulation
bun run spec -- --verify                           # also Apalache (Java 17+), up to 4 steps
bun run spec -- --verify --steps 5                 # deeper; see "Numbers" for the cost
cd packages/spec && npx quint run polaris.qnt --main=finding2 --invariant=archivedIsClosed   # a finding's counterexample
```

`quint run` and `quint test` download Quint's Rust evaluator on first use, and `quint verify` downloads Apalache; both come from GitHub releases.

Trace validation:

```sh
cd apps/daemon && POLARIS_TRACE_DIR=/tmp/polaris-traces POLARIS_PBT_RUNS=30 bun test src/verification/engine.model.test.ts
cd packages/spec && bun scripts/replay.ts /tmp/polaris-traces
```

## What the model says

**State.** `log` and `receipts` are the database (they survive a crash). `queue`, `toPublish` / `toSettle` / `toReact`, `reactor`, `harness` and `subs` are Daemon memory (a crash empties them). `feeds`, `sentBy` / `sentCmd` and `answers` are the Clients (they outlive the Daemon). `lastRestart` and `crashes` are ghost variables for the properties.

| Spec | Code |
|---|---|
| `log: List[Event]` (a position is a sequence) | the `events` table; `ReadModel.sequence` |
| `receipts: str -> Receipt` | the `command_receipts` table (`Applied(seq)`, `Refused` for a rejection) |
| `viewOf(log, s)` / `applyEvent` | `model.ts` `project`, reduced to a Turn's status, the Session State and pending approvals |
| `decideClient` | the session machine (`engine/session.ts`, driven by `decider.ts`): `SendTurn`, `Continue` (refused once its Interrupted Turn is accepted), `Retry` (only after a Failed Turn, as a new Turn; the spec leaves out its prompt), `RespondToApproval`, `ArchiveSession` (`session.archive`: refused with a Turn in flight in every state), `UnarchiveSession`, `AcceptTurns` (`turns.accept`, `engine/session.accept.ts`), and `RecordVerdict` (`engine/review.ts`, always recorded once its Finding exists) |
| `AcceptTurns({ session, through })`, `TurnsAccepted(n)`, `SessionView.accepted` | `AcceptTurns`, `TurnsAccepted` (`throughIndex` + 1: the spec numbers Turns from 1), `AgentSession.acceptedThroughIndex`. Refused with a Turn in flight, when Archived, for a Turn that doesn't exist or one before the accepted one; the same Turn again records nothing |
| `RecordVerdict`, `ReviewRecorded` | `RecordVerdict` / `VerdictRecorded`, standing for every review-only event (`reviewOnlyEventTypes` in `store/model.ts`: Risk Summary and Finding events too): no session, and left out of the host stream (`hostOmittedEventTypes`) |
| `Applied(0)`, `Ok(0)` | a command accepted with nothing to record (accepting the same Turn again, `SetModel` to the same Model): its receipt and ack carry no sequence (`null`) |
| `REVIEW_COMMANDS` | whether Clients send `AcceptTurns` / `RecordVerdict` (`review` and `finding4`); off in `current`, so its coverage of the M1 interleavings stays what it was |
| `CONTINUES_ACCEPTED` | `turn.continue` without the `lastIsAccepted` check (finding 4; now `false`) |
| `acceptsTurn` | `takesTurn` in `session.ts` |
| `backToWork` | `approval.respond` / `harness.approvalWithdrawn` in Needs You: the last request closing moves to Working only with a Turn in flight |
| `decideHarness` | the session machine's `harness.*` events (`session.ts`, fed by `supervisor.ts`): `ApprovalRequested` (only for the Turn in flight; `approvalRequested`), `ApprovalWithdrawn`, `ItemCompleted`, `HTurnStarted` (a live Idle Harness starting a fresh Turn after background reports; `Turn.trigger` is metadata), `TurnEnded` (only for a working Turn; Archived records it without leaving Archived; `HTurnFailed` is a `TurnEnded` with status `failed`, which moves to Failed) |
| `turnsOf`, `HarnessEv.turn`, `inFlight` | a Harness report's `turnId`: the spec numbers Turns per session instead (a Continue resumes the same Turn, as it keeps its id) |
| `recoverSession` / `restartIn` | the machine's `daemon.recover`, run by `recovery.ts` when the Engine starts, before the Engine serves anything (Archived: close what an older log left open, stay Archived; Failed stays Failed) |
| `queue` + `clientSends` / `clientRetries` / `harnessReports` | `EventStore.commit` pushing onto `queued` (from `dispatch.ts` and the runtime's `recordFor`) |
| `commitBatch` | the drain in `EventStore.ts` `groupCommit` (`drain` → `writeBatch` → `runBatch` → `decideOne`): every queued command, decided in order against the model the previous ones produced, in one transaction; a duplicate id within the batch is answered from the batch |
| `publishBatch` | after the transaction: `Ref.set`, `hub.publish`, `Deferred.done` (the ack), and the reactor forked by `dispatch` |
| `reactorRuns` | `react` → `runTurn` → `openHarness` (only if the Turn is still working); for Archive, `stopHarness` |
| `subs[(client, stream)]`, `subscribe` / `readCut` | `subscribeHost` / `subscribeSession`: `store.subscribe` first, then the model's sequence as the cut, a Snapshot or a replay of `(after, cut]`, then `Synchronized` |
| `Sub.buf`, `offer`, `dropped`, `streamEnds` | `LiveHub` (`store/hub.ts`): the bounded per-subscriber queue, dropped (not skipped) when full; its stream ends once drained |
| `deliver` | the live filter `sequence > cut`, then the feed's `handle` |
| `feeds`, `handle` | `makeFeed`: `lastSequence`, dedupe of `sequence <= last`, a Snapshot resets, and the `gapless` reopen |
| `HOST_FEED_GAPLESS` | `HostConnection.ts` opening the host feed with `gapless: true` (finding 1; now `false`) |
| `ARCHIVE_IGNORES_TURN` | `session.archive` without the Turn-in-flight guard, as In Terminal and Starting had it (finding 2; now `false`) |
| `RECORDS_LATE_REQUESTS` | `harness.approvalRequested` recorded whatever its Turn, and the last answer moving to Working with no Turn (finding 3; now `false`) |
| `crash` / `restart` | the Daemon dying at any point (kill, crash, upgrade exec) and starting again on the same database |
| Worktree setup | `SetWorktreeSetup` commits `WorkspaceUpdated`; null selects lockfile detection. Before worker `AttemptStarted`, preparation provisions its Session and commits bounded `SessionSetupChanged` start/completion cards. Initial setup has no Turn and acquires no `__workers` lease; `Attempt.startedAt` follows setup. A same-worktree retry compares a persisted command/manifest/config/lockfile fingerprint; changed inputs, legacy fingerprints and MergeConflict require setup again. Its additive `Attempt.startupSetup` intent commits immediately while the prior Turn runs. After acquisition and the Session boundary, setup completes before the brief; failure enters Failed and the startup scope releases the worker slot. Setup stores the resulting fingerprint after the command completes. Each input is read once per snapshot; an existing successful setup needs a comparison snapshot, and a changed setup needs its resulting snapshot. Fingerprints also cover yarn.lock, Cargo.lock, go.sum, Gemfile.lock, requirements*.txt, poetry.lock and .tool-versions at root and nested workspace paths. Restart replays the intent and setup receipt, so successful setup is not duplicated. Failure uses the Turn-less `session.setup` machine input to enter Failed and refuses dispatch with `E-SETUP`. `worktree_setup.qnt` checks setup failure/restart/repair, stale completion and Attempt → slot → first Turn ordering; the independent Session model test and production composition tests validate the real decider and commits. The general replay reader drops setup metadata like Workspace updates; C1 replay observes startup `TurnStarted` facts and ignores other Session events. Real-store preparation tests assert ordering, retry and absent Attempt/Turn/lease on failure. Older Clients do not receive setup events without `workspace.setup`; absent Workspace/Session fields decode null. |
| Walkthrough metadata | Optional `walkthrough` / `deltaWalkthrough` on `RiskSummaryStarted` and `RiskSummaryLayerChanged` use the existing review-only event path (`store/review.ts`). Ready walkthrough heads stay cached across explicit Reviewer refreshes. Metadata changes preserve the Reviewer layer; no new event tags, receipt, ack, feed, or Session State semantics. Write/Retry starts a normal read-only Agent Session with `StartSession`; Stop uses the existing `Interrupt` machine command. Older Clients ignore optional metadata and do not advertise `review.walkthrough`. |
| Re-claim questions | Identical still-open question ids keep their durable question and pending notification. Changed, answered and duplicate ids remain refused. Unit and SQLite replay tests cover the same question on both Claims; the graph model abstracts questions as notifications. The Desktop Accept form remounts on Attempt id/revision/head so input, receipt choices and refusal copy belong to the current Claim. |
| `CAPACITY` | `StoreConfig.subscriberCapacity` |
| Inline proposals | `inline.propose` is an ephemeral RPC stream with no commands, committed events, receipts or recovery state. Conversion uses the existing `StartSession` command; command, ack and feed semantics are unchanged. |

**Properties** (all in `safety`, checked after every step):

- `gaplessLog`: sequences are 1, 2, 3, … with no gap.
- `feedsAreCommittedPrefixes`: every Client's view of every stream is a prefix of that stream's committed sequence: no gaps, no duplicates, no reordering, across drops, reconnects and restarts.
- `answersAreCommitted`: anything a Client heard back is backed by a durable receipt, and an `Ok(n)` / `Dup(n)` by committed events up to `n` with its id. (Acks come only after commit.)
- `retriesApplyOnce` and `commandEventsContiguous`: a command id is decided at most once, however often it is retried, before or after a crash; its events are one contiguous block.
- `approvalsCloseOnce`: each request is resolved or withdrawn at most once, and only after it was opened.
- `firstAnswerWins`: at most one answer to a request is accepted, and the recorded `resolvedBy` is that device.
- `restartWithdrawsApprovals`: after a restart no request from before it is pending.
- `noAutoContinue`: only a Client command reopens an Interrupted Turn. A live Idle Harness can start a fresh Turn (`HTurnStarted`) after background reports; a Harness runs after a restart only if a command after the restart started a Turn.
- `interruptedNeedsYou`: an Interrupted Turn leaves its session Needs You (until a Client continues or replaces it, or archives the session).
- `approvalsNeedATurn`: an approval is pending only while a Turn is in flight (finding 3).
- `workingHasATurn`: a session is Working only with a Turn in flight (finding 3).
- `archivedIsClosed`: an Archived session holds no Turn in flight and no pending approval (finding 2). With `restartWithdrawsApprovals` and the recovery rule, nothing stays open after a restart either.
- `hostFeedCanProgress`: the next host-stream event after a host feed's last one never makes it reopen (finding 1). Stated through the feed's own `handle`, so it is not vacuous when the gap check is off.
- `acceptedNeverInFlight`: acceptance never passes the Turns that exist, and an accepted Turn is never in flight again (finding 4).
- `acceptedOnlyForward`: each session's `TurnsAccepted` events only move forward.

Each finding's instance (`finding1` … `finding4`) is the code before its fix; `bun run spec` checks that the simulator still finds its violation, so a property that stops guarding a finding is noticed.

**Liveness.** `feedsCatchUp` (`fairness implies eventually(always(caughtUp))`): under weak fairness of `restart`, `commitBatch`, `publishBatch` and every feed's `subscribe` / `readCut` / `deliver` / `streamEnds`, with Clients, Harnesses and crashes acting finitely often (bounded by `MAX_LOG` and `MAX_CRASHES`), every feed eventually sees its whole stream. It is stated in the spec but not model-checked (Apalache's temporal checking does not reach the depth this needs; see "Numbers"). The model-based tests check it on the real code at the end of every run: with every Client reading again, each feed must catch up. In `finding1`, it is false for the host feed.

**Environment assumptions.** A Harness reports items and the end of a Turn only for the Turn it runs, until it ends it (`harnessReports`' guards). It may start a fresh Turn while Idle after background reports (`HTurnStarted`), but cannot reopen an Interrupted Turn or start a Harness after a crash. It may ask for approval late: after its Turn ended, and any report may be decided after later decisions ended its Turn or started another (the report carries its Turn's number, which the decider compares, as the code compares `turnId`s). Request ids are fresh. Sessions exist from the start, Dormant (`StartSession` is a `SendTurn`).

### What it leaves out, on purpose

- Starting (counted as Working), In Terminal, the Failed that a Harness exit or `session.fail` causes (a failed Turn's end is modelled), Forks, Workspaces, Worktrees, checkpoints, cursors, renames, attachments, Steer, Interrupt, permission modes, Models, effort and Codex service tier (`SetModel`, `SessionModelChanged`: refused while a Turn is in flight, so it never interleaves with one; absent tier preserves the selection, `priority` enables fast mode and `default` explicitly disables it, and it changes no Turn status, Session State or approval), background task metadata (`AgentSession.backgroundTasks`, `SessionBackgroundTasksChanged`, and `BackgroundTasksReported` triggers; live tasks suppress the existing idle stop, and Harness loss clears membership) and Subagent metadata (`background`, `report`, and live helpers suppressing the existing idle stop; `SubagentStarted`, `SubagentEnded` and a Subagent's own items: they change no Turn status, Session State or approval, and a Subagent that outlives its Turn ends with the Harness at the latest, like a pending approval; `apps/daemon/src/engine/session.subagents.test.ts` checks the rules), context usage (`SessionContextUsed`: a Harness report committed like a rename, with no command, and left out of the Host stream; it changes no Turn status, Session State or approval), the idle timeout (→ Dormant) and the upgrade hand-off. None of them changes how events are committed or delivered. Archive and Unarchive are modelled; since Starting counts as Working, "Archive with a Turn in flight" in the spec stands for the Starting and In Terminal cases the code accepted before finding 2's fix (`ARCHIVE_IGNORES_TURN`). Interrupt is still left out (it interacts with approvals like Archive; a later extension).
- Review Checkouts (`ReviewCheckoutOpened` / `Changed` / `Removed`): host-level events committed like a Workspace's, changing no Turn, Session State or approval. Their lifecycle is its own pure decider (`engine/checkout.ts`), tested on its own (`checkout.test.ts`). `SendFeedback` is a `SendTurn` (`turn.send` with a rendered prompt); `LinkPullRequest`, `TurnsReverted` and `revertLaterTurns` change no state the spec tracks.
- Capability gating: a Daemon leaves out the events a Client didn't announce a capability for (`eventCapability`). For that Client they are gaps like another session's events, which its feeds already allow (they are not gapless); the spec's Clients announce everything.
- Ephemeral items (`Delta`, `ItemProgress`): they are never sequenced and are only buffered below half capacity, so they cannot drop a subscriber (the store model-based test checks that).
- Transaction failures other than a crash, and the one-by-one retry of a failed batch. An OS crash that rolls back the last WAL commits (`synchronous = NORMAL`): the model's database never loses a commit.
- Recovery runs as one atomic step. In the code it is one commit per session; a crash in between leaves some sessions recovered, and the next start recovers the rest, which ends in the same state.
- The RPC transport: a stream is a list of items in flight; flow control is the hub buffer.
- The feed's cache and `maxCachedEvents` (a fresh Snapshot resets the view, which the model covers).

## Model-based tests (the real code)

`apps/daemon/src/verification/` holds fast-check model-based tests that drive the real code through its public APIs and check the same properties after every step:

- `store.model.test.ts`: the real `EventStore` on a SQLite file. Bursts of concurrent commits (fresh ids, retries, duplicates within a batch, Daemon events; accepted, rejected, empty and defective decisions) whose start order and batching `fc.scheduler` picks; subscribers with a buffer of 1–4 that pause and resume and follow the store's contract (subscribe, cut, replay, resume from the last sequence when dropped); ephemeral output; crashes mid-burst and between bursts. A reference model replays the store's decisions in the order it took them and predicts every answer exactly.
- `engine.model.test.ts`: the real `Engine` with the fake Harness, two devices, and the Client's real `makeFeed` for the host stream and both session streams of each device (behind a detached "network" so a stalled Client backs up into the Daemon's hub buffer). Bursts of commands (including Archive, Unarchive and AcceptTurns) and Harness events (including late approval requests for a Turn that ended), answer races, stalls, disconnects and crashes. A reference decider checks every command's recorded events against the log right before them, and every rejection against some state while it was in flight; approval, recovery and no-auto-continue checks as in the spec; each recorded request is for its session's Turn in flight, nothing is pending and no session Working without one, no Archived session holds one, and no accepted Turn is in flight; the read model against a fold of the log; each feed against its stream and each Snapshot against the log at its sequence; every feed catches up at the end. The reference fold and decider are in `engine.reference.testing.ts`, the Engine, fake Harness and Client feeds it drives in `engine.world.testing.ts`, and the per-step checks in `engine.invariants.testing.ts`.
- `findings.test.ts`: the bugs below, as regression tests (a new finding that cannot be fixed at once goes there as `test.todo`).

`POLARIS_PBT_RUNS` sets the number of runs (CI: 25 for the store, 12 for the Engine), `POLARIS_PBT_SEED` replays a seed fast-check printed, and `POLARIS_PBT_STATS=1` prints what the runs reached.

## Trace validation

`engine.model.test.ts` writes each run's committed log, the commands sent and the restart points when `POLARIS_TRACE_DIR` is set (Interrupt is then left out, as the spec has no Interrupt). `scripts/replay.ts` maps each log to the spec's events, splits it into the decisions that produced it (a Client command, a Harness report, a restart), and writes a Quint run that replays exactly those decisions with the spec's actions; `quint test` then checks the spec records the same events in the same order, with `safety` after every decision. The replay found finding 3 and showed that recovery visits sessions in the order the read model loads them (by last update), not creation order (harmless; the spec takes the order as a parameter, `restartIn`).

## Numbers

Measured on an Apple M-series laptop.

| Check | Bound | Result |
|---|---|---|
| `quint test` | 17 scenarios, and one per finding's mutant | pass (< 2 s each) |
| `quint run --main=current --invariant=safety` | 3000 traces × 60 steps (180k steps), seed `0x5eed` | no violation, ~25 s; every witness reached (dropped subscriber in 36% of traces, resume after a drop 1.5%, answer race 0.07%, restart withdrawing an approval 0.13%, Continue 2%, Retry 1%, Archive 48%, Archive refused 11%, Unarchive 7%, a late request about to be decided 14%) |
| | 20000 traces × 60 steps | no violation, ~145 s |
| `quint run --main=finding1 --invariant=hostFeedCanProgress` | | violation in the first trace |
| `quint run --main=finding2 --invariant=archivedIsClosed` | | violation in the first traces |
| `quint run --main=finding3 --invariant=approvalsNeedATurn` | | violation in the first traces |
| `quint run --main=review --invariant=safety` | 3000 traces × 60 steps, seed `0x5eed` | no violation, ~17 s; an accept in 5% of traces, a refused accept in 76%, a Verdict in 51% |
| `quint run --main=finding4 --invariant=acceptedNeverInFlight` | | violation within the first traces |
| `quint verify --main=small --invariant=safety` (Apalache 0.56.1) | 3 steps | no violation, ~38 s (the spec before Archive and late requests: ~17 s on the same machine) |
| | 4 steps | did not finish: out of the default 4 GB heap after 9 min, still running after 33 min with 16 GB. The spec before these changes (`2783643`) did not finish 4 steps within 10 min on the same machine either, so the ~55 s measured earlier no longer reproduces here; CI runs it report-only |
| Mutants (a subscriber that skips instead of dropping; no batch-local receipts; no withdrawal on restart; no pending check on answers; no client dedupe *and* no live cut filter) | 3000 traces | each violates `safety` within seconds (measured before Archive was modelled) |
| Store model-based test | 1000 runs | pass, ~8 s (CI: 25 runs) |
| Engine model-based test | 500 runs | pass, ~24 s (CI: 12 runs); 145 Archives, 14 Unarchives, 41 late requests |
| Trace validation | 150 Engine runs, 1230 decisions, 1787 spec events (9 accepted Retries) | all conform |
| | 40 Engine runs with `AcceptTurns` (M2), 301 decisions, 479 spec events (13 Accept commands, 9 accepted) | all conform |

Archive and Unarchive (on by default) and late requests make the simulator spend traces on Archived sessions: a dropped subscriber, an answer race and a restart withdrawing an approval are reached less often than before (66% → 40%, 0.3% → 0.07%, 0.2% → 0.17%), but still in every run of `bun run spec`, which fails if a witness is never reached.

Apalache is exhaustive only up to its step bound, and most interesting interleavings need 8–15 steps, so the simulator (random, deep) and the model-based tests (real code) carry most of the weight; Apalache guards the shallow corner cases.

## Findings

Findings 1–3 are fixed on `fix/verification-findings`, finding 4 on `m2/protocol`; each has a regression test in `findings.test.ts`, a property in `safety` and a mutant instance (`finding1`–`finding3`) the simulator must still catch.

1. **The Client's host feed stalled after the first Turn** (`packages/client/src/HostConnection.ts`). `HostConnection` opened the host feed with `gapless: true`, but the Daemon's host stream leaves out session-only events (`TurnItemCompleted`, `CheckpointRecorded`), so its sequences have gaps. At the first one the feed reopened from its last sequence; the replay had the same gap; it reopened again, in a loop with no delay, never advancing past the first checkpoint or item of any Turn and hammering the Daemon with resubscribes (over 5000 in 250 ms). Spec: `hostFeedCanProgress`. **Fix**: the host feed opens with `gapless: false` (the sequence dedupe is enough: a dropped subscriber's stream ends, it is never skipped), and `makeFeed` backs off reopens that make no progress (25 ms doubling to 5 s), so no stream can make a feed loop hot again (`client.test.ts`).
2. **Archiving an In Terminal session mid-Turn left the Turn working and its approvals pending forever** (`engine/session.ts`: the top-level `session.archive` handler, and `daemon.recover` skipping Archived). Archive was refused with a Turn in flight only in the `live` states; In Terminal, Starting, Dormant and Failed archived without checking, nothing ended the Turn or withdrew its requests, and recovery skips Archived sessions. Spec: `archivedIsClosed` (Archive was not modelled before; with it, the mutant fails in the first traces). **Fix**: Archive is refused while a Turn is in flight in every state, with the live states' reason ("interrupt the Turn in flight before archiving"), and withdraws anything still pending. Refusing rather than ending the Turn: Archive never discards a Turn the user may still be watching in the terminal UI, one guard covers every state, and Interrupt (in Polaris or the terminal UI) always ends the Turn first. Recovery now closes what an older log left open in an Archived session (the Turn Interrupted, its requests withdrawn) and keeps it Archived.
3. **A late approval request left a session Working with no Turn** (`engine/session.ts`, `harness.approvalRequested`). The machine recorded a Harness's request whatever its Turn's state. One that arrived after the Turn ended put the session in Needs You with no Turn; answering it moved it to Working, still with no Turn, and `SendTurn` was refused until a restart. Found by trace validation. The spec could already reach it (a request queued before its Turn's end, decided after it), but no property looked. Spec: `approvalsNeedATurn`, `workingHasATurn`, with Harness reports now carrying their Turn and allowed to arrive late. **Fix**: a request for a Turn that is not the Turn in flight is ignored, as a `TurnEnded` for a Turn that is not working already was, and the last answer or withdrawal moves to Working only with a Turn in flight.

4. **Continue reopened an accepted Turn** (`engine/session.ts`, `turn.continue`; found while specifying `AcceptTurns`). Accepting Turns takes a contiguous prefix; accepting through an Interrupted Turn and then sending Continue resumed that same Turn, so work the user had accepted changed afterwards. Spec: `acceptedNeverInFlight` (the simulator finds it within the first traces of `finding4`). **Fix**: Continue is refused once the Interrupted Turn is accepted ("the Interrupted Turn is accepted; send a new Turn instead"); a new Turn carries on.

## Open issues

- The spec does not model Interrupt, In Terminal, Starting (counted as Working), Forks or the upgrade hand-off.
- Apalache no longer finishes 4 steps of `small` locally (neither does the spec from before these changes), so `bun run spec --verify` and CI's report-only step will likely run out of memory or time. Either lower CI's bound to 3 steps or slim `small` down (e.g. a constant that leaves Archive and late requests out of it).
- `feedsCatchUp` is stated, not model-checked; the model-based tests check it on the real code.
- The model-based tests "crash" the Daemon by disposing its layer, which lets an in-flight transaction finish; a hard kill (a subprocess and `SIGKILL`) would also cover commits decided but not written.
- A late approval request is dropped without an answer to the Harness. That is right for the Turn-scoped requests the drivers send today; a Harness that asked about an ended Turn and blocked on the answer would wait until its next Turn or exit.
- Interrupt with no Harness running (`turn.interruptUnattended`) moves an In Terminal session to Dormant, even though its terminal UI may still be open (the Claude hand-off follows the TUI without a Harness). It is how a user ends a Turn the TUI left open before archiving; a follow-up could keep In Terminal there.
- Checked against the ENG-210 session machine (merged at `1285069`).

## Constellations v1 (C1-P, ENG-236/ENG-243/ENG-244)

`constellations.qnt` is the reference model for the Constellation contract in
`packages/protocol/src/constellation/` and ADRs 0004/0011. It runs alongside the
existing store/session spec. `constellations_test.qnt` contains 28 command/race
scenarios and 25 malformed-event probes that must violate the corresponding
property. `scripts/check.ts` typechecks both files, runs both test modules, then
simulates the Constellation `safety` conjunction with required witnesses for
Claim, acceptance, Gate, handover, delivery, relay, recovery and lease grants.

The default `current_constellations` instance has three Tasks, four sessions, six resource/outbox request IDs, one
Constellation owner and one capacity-two Host resource. Dependency closure is
bounded by the Task set, not by a hard-coded depth. Commands allocate append-only
Attempt indices and relative revision counters (wire revision numbers are checked by the real decider tests); batches either append all operations or none.
`log` is the durable owner stream. `view`, including pending notification IDs,
is always `foldEvents(log)`. Worker `outbox` and interruption markers survive
`restart`; app connection, owner availability and Offline sessions are separate
inputs. The simulator explores up to 60 actions per trace; temporal obligations
do not have a log-size cap that could artificially prevent a grant or digest.

| Model | Contract / implementation responsibility |
| --- | --- |
| `planEvents`, `opEvents`, `validGraph` | `ConstellationCommand.Plan`, `PlanOperation`: atomic Add/Edit/Cancel with revisions; reject cycles, missing/canceled deps and cancellation with dependents; parent closure validates unknown/cyclic parents, Gate/started containers and ancestry deps, cancels descendants atomically |
| `start`, `current`, `change`, `latest`, `taskState` | `AttemptStarted`, Attempt revision, linked `AttemptCause.ref`, `TaskProjection`; engine decider folds the graph rather than persisting Task state |
| Observed worker liveness | `TaskProjection.liveness` and `ConstellationStreamItem.LivenessChanged` are runtime observations, not graph events. The live item is unsequenced/unpersisted like session item progress; it changes no command, receipt, revision, resume cursor or recovery decision. Unknown facts are null in required Snapshot projections. Elapsed time is derived from observed timestamps without Daemon timers. |
| `claim`, `accept`, `reject`, `stop`, `harnessFail` | worker Claim, ReviewAction, AttemptClaimed/Accepted/Rejected/Settled; Claim requires a clean matching branch; in review a changed head supersedes the prior Claim on the same Attempt and advances its revision. Old Claims remain in the event log, approval/handoff metadata resets, and Accept requires the latest revision/head |
| `rejectWithReason`, `retryBrief`, `startFirstTurn`, `firstTurnAtMostOnce` | `AttemptRejected.reason` folds into additive nullable `Attempt.rejectionReason`, retained beside the old Claim in graph snapshots; status shows three lines from the latest sent-back Attempt. Composition follows `SentBack`/`MergeConflict.ref` to supply verbatim feedback and the rejected Claim; MergeConflict names the base to merge first. Startup checks the persisted `${attempt.id}:start` command receipt for every Attempt, including Initial; the receipt survives more than 32 Turns. Authenticated MCP tests cover same/fresh, MergeConflict, production Daemon restart before delivery, Initial startup and recovery after 34 retry Turns. `mcp/sendback.remote.test.ts` uses two fake Hosts with real SQLite/Git/socket outbox relay, MCP Claim/review, durable assignment mirroring and remote working-scope resume; Harness effects and worker provisioning remain fake. |
| Fetched branches | `ConstellationStreamItem.BranchFetched` and required Snapshot `TaskProjection.branchFetched` observe an exact claimed commit at the owner Polaris ref. They carry no sequence or graph revision; Accept additionally probes the actual merged Lead head. Bundles stream through existing BlobChannels without retaining bundle-sized buffers. |
| `leafState`, `taskStates`, `settlementOutcomesValid` | Mapped unstarted leaves project ready/waiting from effective dependency acceptance; pending proposals are intent outside the Task graph. Removed unproduced `future` TaskState and `settled_unverified` Attempt/Task/outcome; only lost/failed mechanical outcomes, evidence tiers remain on accepted Claims. `unstartedTasksAreReadyOrWaitingAcrossRestartTest` and `detectsRetiredSettlementOutcomeTest`, protocol schema rejection, Desktop model regressions and `verification/constellation.states.test.ts` cover readiness, restart, acceptance tiers and full real-event trace replay. |
| `effectiveDeps`, `ready`, `promote` | own and inherited prerequisites gate descendant readiness, named dispatch retries and Gate promotion; accepted leaf Attempts and done parent rollups satisfy dependencies, never Claims or mechanical settles |
| `ask`, `finish`, `deliver` | NotificationQueued and LeadNotified; committed notification IDs, one durable digest Turn, retained across restart and handover |
| `handover`, `setState` | atomic LeadChanged and the planning/running/paused/completed/archived lifecycle; an active Gate on the departing Lead settles lost in the same batch, while other workers are unchanged |
| `FirstTurnStarted`, `firstTurnAtMostOnce` trace mapping | Actual worker-Host `TurnStarted` with `${attempt.id}:start` maps to the abstract first-Turn fact. The mapper validates the assigned Host and Session; graph events remain owner-only. Replay rejects duplicate startup Turns and `firstTurnValid` rejects blocked, review, settled, superseded or stale Attempts. Worker-Host startup rechecks the durable assignment under commit; local ineligible startup fails without an empty success receipt. Pending startup can send through the Session machine after a restart-interrupted Turn with no pending input, using its acquired worker slot. Busy same-session SendBack commits the retry immediately. A shared per-Session gate in `engine/sessionBoundary.ts` prioritizes its missing durable startup receipt over Lead delivery and user Turn commands, and serializes readiness, deferred setup, retirement, commit and actual Harness submission. A user `SendTurn` queued behind startup waits until the brief Turn ends; `Steer` bypasses the startup fence and targets the still-running Turn. A separate FIFO holds each startup-related new-input waiter through readiness and commit, so later prompts join the queue even during its last active Turn. TurnEnded removes queue mode; unrelated busy commands retain their existing refusal. Session-scoped subscriptions receive only relevant graph lifecycle wakes through an internal opt-in; Client Session feeds retain their existing contents. Remote assignment versions and reads are indexed by Session. A nonempty durable `${attempt.id}:startup-failed` receipt clears the fence through manual setup repair, Retry and restart; startup failures release their worker scope and require a new Attempt to start automatically. `session_input_queue` checks old-Turn steering, FIFO including later arrivals and failure-fence release. Local input, remote input, digests and nudges use this gate. A second startup waiter checks the receipt inside the gate before retirement. Waiting remote deliveries release the gate until a Session event wakes them. `firstTurnValid` also rejects a brief after a Worker input on the pending Attempt; boundary tests cover both caller orders with a real Engine, fake Harness and queued Lead/user inputs. Feedback, merge bases and Host ids use injective UTF-16 hex literals because Quint strings have no JSON escape syntax; quote/newline tests run through Quint. |
| `commit`, `enqueue`, `relay`, `availability` | owner-only events, ConstellationOutboxEntry stable IDs, app relay and unavailable owner; `transfers/outbox.ts` persists the worker intent, decides under EventStore.commit, and retains apply/refusal receipts. Client `constellation/relay.ts` uses existing HostConnection streams and retries durable packets after reconnect. `transfers/relay.test.ts` covers disconnect after owner commit before receipt saving and refusal replay |
| Lazy runtime activation and codecs | Persisted event shapes remain compatible; AttemptClaimed now resets review metadata in both folds. `store/eventJson.test.ts` checks canonical per-kind validation, including deferred Constellation payloads and constructor defaults; `constellation/liveness.test.ts` checks a producer captured before provider activation. `transfers/remoteWorking.test.ts` checks that a new Attempt receives its first brief even when its Existing Session has historical Turns; resume depends on that Attempt's startup or an explicit recovery call. |
| `interrupt`, `recover`, `restart` | AttemptInterrupted is committed atomically with Session daemon recovery; it retains the interrupted Turn ID, event.at and eligibility before approvals are withdrawn. AttemptRecoveryContinued consumes one automatic Continue per Attempt. Replay requires eligible interruption proof; restart and upgrade re-fold it, while standalone, Lead, user interruptions and unresolved approvals stay attention. The simulator uses `recoverPending` to sample eligible working Attempts, matching the runtime scan and preserving its required recovery witness. |
| `request`, `grant`, `release`, `cancelLease` | Host ResourceDeclared/ResourceLeaseQueued/ResourceLeased/ResourceReleased/ResourceLeaseCanceled/ResourceRemoved: request IDs are lease IDs, FIFO capacity, explicit or process-bound release |

The 15 spec properties (§11) map as follows. Safety checks every explored state;
FIFO eventual grant and eventual delivery are temporal formulas with explicit
availability/fairness assumptions, not claims proved by a finite simulator.

| §11 property | Quint property | Scenario |
| --- | --- | --- |
| Graph is acyclic | `graphAcyclic` | `atomicPlanRejectsEveryOperationOnACycleTest` |
| Causes point backward | `causesPointBackward` | `linkedCausesPointBackwardTest` |
| Task follows latest Attempt | `taskFollowsLatestAttempt` (derived by construction) | `taskFollowsItsLatestAttemptTest` |
| Gate only after every dep accepted, once | `gatePromotedOnlyAfterAccepted` | `gateCountsOnlyAcceptedAttemptsAndPromotesOnceTest` |
| One Lead, atomic handover | `oneLead` (one folded Lead identity) | `handoverIsAtomicAndDoesNotTouchWorkersTest` |
| One active Attempt per session | `oneActiveAttemptPerSession` | `sessionCannotCarryTwoActiveAttemptsTest` |
| Every settle/question delivered exactly once | `exactlyOnceDelivery`, `everyNotificationEventuallyDelivered` | `settlesAndQuestionsAreDeliveredOnceAcrossRestartTest` |
| Settled Attempt cannot change | `settledAttemptImmutable` | `settledAttemptsNeverChangeTest` |
| Outbox entry applied once | `outboxAppliedExactlyOnce` | `outboxRetriesSurviveAppDisconnectAndLostAckTest` |
| Only owning Daemon commits | `onlyOwnerCommits` | `onlyTheOwnerDaemonCommitsTest` |
| At most one auto-Continue per interruption | `recoveryAtMostOnce` (also one total per Attempt) | `delegatedRecoveryContinuesOnlyOnceTest` |
| Stale never settles without a command | `staleNeverSettlesWithoutCommand` | `staleHostCannotMechanicallySettleTest` |
| No delivery to old Lead | `noOldLeadDelivery` | `oldLeadNeverReceivesAnInTransitDigestTest` |
| Holders never exceed capacity | `resourceCapacity` | `resourceCapacityCannotBeExceededTest` |
| FIFO waiter eventually granted | `fifoGrantOrder`, `fifoWaiterEventuallyGranted` | `fifoWaiterIsGrantedWhenAHolderReleasesTest` |

The FIFO liveness premise requires the owner to be available and the grant and
holder-release actions to run fairly. A holder that never exits or releases can
hold forever by product design; this model does not kill it to satisfy liveness.
Delivery similarly requires a running Lead, an available owner and fair digest
execution. Pause/offline states retain pending IDs and make no progress promise.
The scenario tests discharge these obligations once availability/release returns.
The temporal formulas are typechecked; the current `--verify` path continues to
verify the existing `small` session model, not Constellation temporal liveness.

This abstraction retains SendBack feedback but leaves out other prose, bundled git bytes, receipt output, permission
binding cryptography, notification wall-clock coalescing and the actual Harness
Turn queue. Stale is an external Connection State input, never an LLM decision.
Recovery tests capture the durable allowance, while the session spec retains the
standalone user-Continue rule. `OutboxApplied` is a ghost representation of the
owner's idempotent decision receipt, not a new public Constellation event.

The existing real Engine trace-validation command above still checks sessions,
store commits and approvals. Constellation and resource traces use:

```sh
bun packages/spec/scripts/replay-constellation.ts /tmp/constellation-traces
# A single .json file is also accepted.
```

The exported Effect Schema and JSON decoder are in
`scripts/constellation-replay/index.ts`. A trace has this shape:

```json
{
  "version": 1,
  "ownerHostId": "lead-host",
  "batches": [{
    "hostId": "lead-host",
    "events": [],
    "context": { "offlineSessionIds": [], "commanded": true },
    "outboxId": "newly-committed-receipt-id",
    "constellationId": "graph-id"
  }]
}
```

`events` contains protocol DomainEvents in committed order. Every graph must
start with `ConstellationStarted` containing an empty planning graph, not a
snapshot. Linked causes reference an earlier Attempt of the same Task.
`context` is required for each batch containing `AttemptSettled`; Connection
State and command authority cannot be inferred from graph events. `outboxId`
represents a newly committed owner receipt, including a refusal with zero graph
events, never an RPC retry. An empty receipt batch can infer its sole graph;
use `constellationId` when multiple graphs exist.

The reader separates Constellation streams and each Host resource stream,
checking the resource's own Host rather than the Lead's Host. It maps capacity
changes, FIFO requests/grants, release, cancellation and removal. Removing a
resource with holders/waiters or granting out of order fails replay. Additional
process identity/command fields are accepted but process liveness and PID reuse
are tested by the resource service, not inferred from this abstract log.

The reserved `__workers` stream now emits the same queued/granted/canceled/released
events as ordinary resources. `workerSlotScopeCloseAndRestartReclaimTest` checks
capacity and FIFO across cancellation, scope release, and restart reclaim. Real
worker FIFO and restart tests emit named `__workers` traces for this reader.
`constellation.stats` is a read-only projection over existing logs and Usage;
its authorization, filtered sequence cuts, and absence of writes/subscriptions
are checked in `apps/daemon/src/constellation/stats/service.test.ts`. No telemetry
state is added to Quint.

Replay checks each committed batch against `safety`; generated Quint sources
are retained on failure. The reader tests exercise the JSON boundary, CLI and
malformed logs. The CLI smoke replays a four-event planning/start prefix once;
the adjacent semantic test retains the full Claim/acceptance/Gate/digest log.
This avoids compiling and replaying the same log twice inside one CI timeout.
It omits metadata prose and abstracts wire revisions; actual
command refusals, role/revision checks, Harness execution and relay idempotency
remain the engine/harness/resource model-based and integration tests. A passing
abstract simulation alone does not verify those runtime paths.

C1-E's real decider maps to `apps/daemon/src/engine/constellation.ts`; graph/store
reference tests and complete committed-log fixtures are under
`apps/daemon/src/verification/constellation*.test.ts`. The additive
`ClaimApproved`, `ClaimHandedUp` and `AttemptNudged` events advance Attempt
revisions while retaining their state. `reviewMetadataValid` checks that approval
and hand-up occur in Review, nudges occur while working, and each marker occurs
once per working interval (unblock resets nudges). Role authorization and refused commands remain real decider
tests. `constellation.defaults.get/set` persist user settings outside the graph
journal; `plan.start` snapshots omitted settings before its serialized decision.
The live producer's ephemeral `LivenessChanged` frames have no global sequence
and are outside this committed-log abstraction. Their capability gate, resume
seeding and graph-revision neutrality are covered by the real producer tests.

Blocking maps `WorkerBlock` to `AttemptBlocked` and a `Blocked` notification.
`blockEvents`, `unblockEvents` and `blockTransitionsValid` model live targets,
unsatisfied acceptance, Gate and transitive wait-cycle rejection, working → blocked → working, and a Turn proof on unblock. `liveBlocks`, `waits`, `reach` and `validGraph` combine live blocked Attempts' targets with inherited dependencies and parent completion edges: mutual blocks are refused by `blockEvents`, and block-closing plan edits by `planEvents`. Accepted Tasks contribute no wait edges. `planGraphValid` validates only newly introduced edges against the resulting graph, so unrelated edits and repair/cancel batches can proceed when an older graph already contains a block cycle. The runtime `constellation/waitGraph.ts` supplies both guards; `E-DEP-CYCLE` names the block edge and reports each directed cycle once, using a rotation-independent key across newly added edges. Cancel drops named targets and queues a Lead notification; an empty set continues waiting for the Lead.
The real journal commits `AttemptUnblocked` with the Session machine's next Turn;
acceptance inputs are re-derived from the durable block on startup. Empty target
sets wait for a Lead message addressed to that worker after the block (Task ids resolve to Worker targets at the tool boundary). Broadcasts remain queued and cannot unblock. The replay `fresh` proof checks both the Worker target and journal order, including messages in the same clock tick. SendBack accepts blocked Attempts and unblock resets the nudge allowance. `constellation/blockCycles.test.ts`, `constellation/blocked.test.ts` and
`constellation/delivery/blocked.test.ts` cover error codes, Turn boundaries,
metadata clearing, atomic markers, SQLite restart and idempotence. The independent
reference fold and generated command model retain block metadata; trace replay
requires the local worker Turn in the same batch. Remote traces require the
worker Host's earlier Turn with the immutable delivery ID before the owner
receipt; remote delivery retains its durable receipt handshake.
`constellation/composition/remoteBlocked.test.ts` exercises separate owner and worker stores with fake Turn runners and an in-process relay: acceptance while the blocking Turn runs leaves the owner blocked; the worker Host's TurnEnded retries delivery, then acknowledgement resumes the owner exactly once without another owner event. `applyWorkerDelivery` keeps the RPC pending on Session events. `RemoteDeliveries.apply` serializes by Session and packet ID, with queue entries released after the final caller; one busy Session cannot hold a Host-wide permit. The Client forks each pending delivery under the worker Connection scope, deduplicates in-flight IDs, and replays Connection observations on worker epoch changes. Owner Connected observations and replayed relay acknowledgements flush failed sends without polling. `composition/remoteBlocked.rpc.test.ts` uses the real transfer service and Unix-socket RPC, with real SQLite and Session machine decisions: acceptance occurs during the blocking Turn, a second Session's delivery completes before TurnEnded, and exactly one owner unblock follows. `transfers/relay.test.ts` also checks the automatic production Client relay while one apply RPC waits. `delivery/remoteRetry.test.ts` injects a failed send and verifies reconnect/ack wakes without an intervening graph event. `verification/constellation.waitGraph.test.ts` compares generated legacy repairs and accepted-edge edits against independent reference guards. These tests use fake Turn runners and temporary Hosts, not a live Harness. The emitted trace places the worker's immutable-ID Turn before the owner acknowledgement. This does not exercise live Hosts or a live Harness.
The relay resolves the owner's live Connection when acknowledging a worker receipt and wakes its drain when an apply fiber exits. `composition/remoteOwnerReconnect.test.ts` drives the production Client relay through real transfer/RPC services: reconnect during a busy Turn acknowledges on the new owner session, commits exactly one `AttemptUnblocked`, and preserves the durable receipt. Retryable assignment failures get one immediate retry; persistent failures wait for a graph/Connection change or explicit retry. The Constellation delivery adapter constructs `RemoteDeliveryPacket` before durable schema encoding. The standalone `constellation_delivery_relay` module in `constellations.qnt` models these ephemeral transport facts separately from the durable journal. `delivery_relay_test.qnt` covers reconnect, cleanup-triggered retry and retry bounds; its safety simulation witnesses both reconnect acknowledgement and retry. The integration trace supplies the earlier worker Turn and replays against the durable Constellation model. Host provisioning and Turn runners are fake; SQLite, the Session machine, RPC and relay are real.

Blocked Attempts skip nudging; a second silent end queues `Stopped` for the Lead.

C1-L implements the delivery runner under `apps/daemon/src/constellation/delivery`,
with timers only for pending Lead-worthy updates (20 s Claims / 5 s blocking Lead
questions). Queued IDs and `LeadNotified` commit with the Session-machine Turn;
worker approvals and questions to the user never wake the Lead.
`LeadHandoverRequested` persists a request without changing the Lead. A later
`LeadChanged.requestId` must match the latest uncancelled request from the current
Lead (`handoverRequestOrdered`); supersession and `LeadHandoverCancelled` invalidate
older completions. The final switch, archive and new header Turn share one commit.
An active Gate attached to the departing Lead is stopped in that batch, with
commanded settlement. The new header preserves its receipts and requests a rerun;
the next Gate Attempt has Superseded cause pointing to the stopped Attempt.
Quint scenarios cover restart, cancellation, supersession and old-Lead delivery.
`WorkerInputDelivered` records one recipient receipt (`inputDeliveredAtMostOnce`);
remote enqueue alone records no delivery. `AttemptStale`/`AttemptFresh` retain
observed intervals across restart without changing Attempt state or revision.
The replay reader maps these journal events. Real runner tests cover coalescing,
Session boundaries, nudge limits, operator authority, peer routing and recovery.

G2's Claude auto-mode preparation guard refuses unsupported model/mode combinations
before Session registration or Attempt creation; it adds no committed events or
state-machine transition. Live SDK fallback is a Harness failure through existing
Session events. These runtime capability checks are outside the abstract graph
model and covered by `harness/claude/autoMode.test.ts` and
`constellation/composition/prepare.test.ts`. Checkpoint identity encoding changes
Git ref names only, preserving journal identities and existing valid refs.

G2's Plain MCP bootstrap submits the existing `Plan.start` command with its authenticated Session as Lead. Stable Lead tool names become usable only after `ConstellationStarted`; current-role checks still run under the commit lock. No graph state or event shape is added to Quint. `mcp/tools/bootstrap.test.ts` checks start-first refusals, Plain-to-Lead promotion, worker-tool exclusion and archive revocation against the real service; composition and Harness tests cover lazy first-session activation and read-only exclusion. ACP's delivery-only context never changes normalized user prompt text.

## M3.1 language contracts

P1 exports `packages/protocol/src/languages/` and the optional Desktop
`shared/languages.ts` tables. `LanguageRpcs` is separate from `DaemonRpcs`;
no current runtime advertises the new capabilities. Host installation facts,
Client settings and execution trust are distinct. No new language events enter
the Agent Session event log or the existing Engine replay format.

External registration/annotation IDs are opaque bounded strings, while
Polaris-owned IDs remain slugs. Record schemas validate every input key without
silently stripping invalid names; environments preserve leading underscores.
Optional K2 artifact packaging survives catalog decoding and requires safe
relative manifest paths. These JSON boundary corrections add no model action,
commit/stream semantics or readiness transition; schema roundtrip/rejection tests
cover them separately from the abstract lifecycle and recovery model.

| Model action | Contract and consumer obligation |
|---|---|
| `Sync` | `LanguageSyncInput` / `LanguageSyncAck`: one contiguous context-local sequence, monotonic document versions and exact previous version; acknowledgment means queued delivery, not completed analysis. The model abstracts a single already-open document per context, with version 0 initially. T1 must additionally verify open/change/save/close and encoding/range handling. |
| `Request` / `Result` / `Cancel` | `LanguageRequestFence`, `LanguageFeatureRequest`, `languageFenceSatisfied`: authenticated Client+Host+checkout+project+provider+configuration+generation identity and exact document snapshots. Typing/cancellation makes old results unusable. The two model keys represent distinct full context identities, not just language or Workspace IDs. |
| `Restart` / `Crash` | Acquire a fresh generation; pending ephemeral language operations do not survive or replay. Send current full snapshots before requests. Durable resource-operation outcomes survive the crash independently. |
| `Prepare` / `Apply` | `LanguageEditProposal`, `LanguageEditAcceptance`, `LanguageOperationStep`: preview and revalidate before applying; prepared/applied journal per operation ID. Model `Apply` is idempotent and cannot reapply a restored operation. It abstracts one resource step; X1 must extend fault coverage to partial multi-step operations. |
| `PersistDrafts` / `PersistReceipt` / `Acknowledge` | `LanguageOperationOutcome`: report applied only after persistent Client drafts and necessary Host receipts are durable. `workspace/applyEdit` uses the same acceptance path. No filesystem-wide atomicity claim. |
| `DiskEdit` / `Undo` | Guarded ownership checks against exact post-operation disk versions; intervening edits prevent restoration. Unresolved recovery is explicit. |

`bun run spec` includes the language typecheck, four scenarios and 3,000
60-step safety simulations. These are finite contract checks, not liveness,
production lifecycle, filesystem or Unicode conversion proofs.

Language trace v1 is independent of the Engine and Constellation trace formats.
`packages/spec/scripts/language-replay/index.ts` validates every event plus a
required observed Context or Operation state. Replay asserts both safety and
the observed outcome after every action. Unknown versions/tags/contexts and
missing observations fail closed. The committed fixture is explicitly
`synthetic-contract`; T1/X1 must produce `runtime` traces from real handlers,
with stable abstraction keys for authenticated full context identities.

```sh
bun packages/spec/scripts/replay-language.ts packages/spec/scripts/language-replay/contract.trace.json
bun test packages/spec/scripts/language-replay
```

The regression suite proves a stale-result observation mutant is rejected by
Quint. Existing Engine traces remain unchanged and still use
`POLARIS_TRACE_DIR` with `scripts/replay.ts`; language text must never be written
into those durable Agent Session traces. Actual consumer model-based and
fault-injection tests remain required before any capability is advertised.

## Regular-file resource operation recovery (X1)

`file-edits.qnt` models one reversible move. `Pending/Forward/Applied/Backward/Restored`
map to the private per-move journal, not the public batch outcome. `Owned` is the
exact pre-move FileVersion, `Missing` an owned absence, and `External` an
intervening version. Forward mutation requires durable intent plus owned source
and absent destination; reverse mutation requires reverse intent plus owned
destination and absent source. Crash and duplicate acceptance do not change
physical locations or reapply. Restart recovery reverses intent/applied moves,
reconciling before/after locations, and rejects any conflicting ownership.

| Model action | Runtime mapping |
| --- | --- |
| Prepare | Schema/owner/preview/draft checks; all canonical snapshots and ordered operations validated; prepared journal fsynced |
| Intent / Move / PersistApplied | `files/edits/index.ts` forward intent receipt, recheck, `moves.ts` rename + directory fsync, applied receipt |
| UndoIntent / Restore / PersistRestored | Reverse journal intent; recheck exact destination/absence; reverse rename; restored receipt |
| ExternalSource / ExternalTarget | Agent/external edit or creation in an owned absence; exact-version recovery refuses it |
| Crash / Retry | Process loss preserves disk/journal; same acceptance returns receipt without replay |
| Ack | Final durable applied outcome and verified Client durable drafts; G2 performs actual transport acknowledgment |

`bun run spec` includes four recovery scenarios and 3,000 60-step safety
simulations. `bun test apps/daemon/src/files/edits` exercises real temporary
files, overwrite chains, reverse crashes, partial failure/cancellation and
subprocess SIGKILL. `model.test.ts` captures actual coordinator checkpoints,
projects source/target FileVersions and private move phase, and runs Quint replay;
a corrupted target-ownership observation must fail. The single-move abstraction
does not claim complete concurrent filesystem atomicity, full batch formal proof,
or directory/symlink recovery. X2 owns tree contracts and operations before G2
can advertise resource capabilities.

To retain and replay runtime evidence:

```sh
X1_TRACE_OUTPUT=/tmp/x1-runtime.trace.json bun test apps/daemon/src/files/edits/model.test.ts
bun packages/spec/scripts/replay-file-edits.ts /tmp/x1-runtime.trace.json
```

Trace v1 requires `source: "runtime"`, bounded recognized events and observed
phase/source/target tokens. The checked-in
`scripts/file-edits-runtime.trace.json` is a real temporary-filesystem coordinator
crash/recovery fixture, not a live transport/Daemon trace. Replay checks every
observed checkpoint against safety; it cannot authenticate arbitrary supplied
trace provenance. No Apalache or formal temporal liveness proof is claimed.

## Directory resource recovery (X2)

`tree-edits.qnt` extends the independent move abstraction with a root and two
representative descendants. Root replacement and either descendant intervention
block forward/reverse moves, while durable intents reconcile after restart.
Runtime validates every entry of the bounded manifest; the two-token model is
an abstraction of that complete ownership check, not a filesystem atomicity proof.
The original `file-edits.qnt` and its fixtures remain unchanged.

`apps/daemon/src/files/edits/trees/model.test.ts` records actual temporary-directory
journal phases and source/destination root/descendant identity and byte ownership.
`replay-tree-edits.ts` projects those observations to the Quint actions; a corrupt
second descendant observation must fail replay. Checked-in recovery and
intervention traces are under `scripts/tree-edits-runtime-*.json`. Replay both:

```sh
bun packages/spec/scripts/replay-tree-edits.ts packages/spec/scripts/tree-edits-runtime-recovery.json
bun packages/spec/scripts/replay-tree-edits.ts packages/spec/scripts/tree-edits-runtime-intervention.json
```

Checkpoint mapping: prepared → Prepare, forward intent → Intent, filesystem
rename → Move, applied receipt → PersistApplied, reverse intent → UndoIntent,
reverse rename → Restore, restored receipt → PersistRestored. SIGKILL/restart
adds Crash/Retry; an actual edited descendant adds ExternalDescendant. A blocked
UndoIntent leaves all owned/external tokens unchanged. Ordered-chain/crash/backup
fault matrices exercise all moves in the real coordinator; the model represents
one move with descendant ownership. Protocol format 2 and R1 integration seams
are described in `packages/protocol/src/languages/TREES.md`. Capability and actual
transport activation remain G2-owned. No Apalache, formal liveness or live Host
transport proof is claimed.

G2's dedicated `languages.tree.edit.decide` payload preserves the format-2
acceptance and durable draft group through Client/IPC schemas before serialization.
`languages.tree.operation.get/recover` retain format-2 outcomes and existing
operation/revision coordinates. Their registry gate is `languages.resources.tree-v2`
plus languages/edits/resources; it is not an advertised production capability.
These boundary declarations introduce no new journal transition in `tree-edits.qnt`.
The existing wire registers typed unavailable defaults and its temporary-socket
negative tests reject malformed raw decisions before fake handlers. Authentication,
durable receipt verification and full preview/outcome boundaries remain required
before activation; these codec tests do not prove production mutation authority.

### T1 Host language runtime mapping

The detached `apps/daemon/src/languages/runtime/` broker implements ordered
P1 document cuts and generation-bound requests. `Documents.apply` corresponds
to `languages.Sync`; `requestRaw` dispatch/result checks and `cancel` correspond
to Request/Result/Cancel. Retiring a process generation on crash, connection loss,
restart, configuration change or trust revocation clears its ephemeral documents
and pending operations, corresponding to Restart/Crash. Resource edits are
proposals only: T1 never applies or acknowledges durable disk changes.

`language-runtime.qnt` separately models the pure XState process lifecycle:
demand, initialize/ready, last-interest grace, crash/backoff, exhausted budget,
manual restart, revocation and disconnect. The root runner includes its typecheck,
three scenarios and 3,000 60-step safety simulations with the existing seed and
CLI overrides. The model abstracts a single process; bounded automatic retries
require new current-generation Client snapshots after invalidation. Host wire
generations are monotonic across contexts, while the P1 abstraction uses a
context-local generation ordinal. Opaque Client/checkout/project/config/provider
identities map to stable model context keys; draft text is absent from traces.

`packages/spec/scripts/language-runtime/replay.test.ts` runs actual bounded stdio
server processes and observes broker lifecycle transitions plus actual ordered
acknowledgments, fenced results and reset snapshots. It writes
`/tmp/m31-t1-lifecycle.trace.json` and `/tmp/m31-t1-language.trace.json`; the former
replays against the dedicated model and rejects an intentionally false Ready
observation, the latter uses the existing P1 replay. The runtime test suite adds
Unicode, two Clients/Worktrees, stale requests, cancellation, malformed input,
crash limits, trust revocation and actual child cleanup. These finite models and
fake servers do not prove liveness, production provider behavior, remote transport,
authenticated G2 composition, artifact readiness or Desktop budgets.

```sh
bun test apps/daemon/src/languages/runtime apps/daemon/src/languages/transport packages/spec/scripts/language-runtime
bun packages/spec/scripts/replay-language.ts /tmp/m31-t1-language.trace.json
bun run spec
```

Parent Tasks add `children`, `descendants`, `lineage`, `effectiveDeps`, `acceptance`, `taskStates` and rolled-up
`accepted` to `constellations.qnt`. The final batch is validated after cancellation
closure; containers cannot start Attempts. `constellation.parents.test.ts` covers
every parent error code, Edit moves, recursive cancellation, rollups, tree status
and Gate promotion. Effective dependencies include every ancestor's prerequisites
for validation, readiness, named retries, Gate promotion and worker dependency Claims;
unmet prerequisites keep inactive parents waiting, including after an Edit.
`constellation.model.test.ts` exercises nested parents, inherited readiness and
parent dependency Edits while comparing independent guards, projections and fold; emitted
traces include parent declarations for replay. The finite closure uses TASKS as
a depth bound; the runtime has no configured nesting limit.

Review-gap regressions: `constellation/composition/busy.test.ts` covers queued same-Session
SendBack, production Daemon restart before Initial/retry startup with a prior interrupted
Turn and an acquired slot, blocked local/remote startup without an empty receipt,
and assignment revalidation at the boundary. `engine/constellation.reclaim.test.ts`
checks changed-head Claims, approval reset and stale revision Accept. Remote relay
tests transfer a revised review head after the owner mirror arrives while refusing
unchanged heads and concurrent pending Claims. Independent
command-model runs include changed-head re-Claims; real-log trace tests reject first
Turns outside working and acceptance of an older Claim. `status.test.ts` checks
full proposal brief, deps, area and criteria in the outline, Lead digest and additive
`ConstellationResult.proposals` JSON. AttemptState remains `rejected` internally;
Lead copy says “sent back”.

`verification/sessionInput.model.test.ts` compares the real Engine’s startup-related FIFO with independent arrival order minus canceled requests, including late prompts after earlier queue entries commit and steering the old Turn. `sessionInput.failure.test.ts` verifies SQLite restart before/after the failure marker and replacing the failed setup card without restoring the fence. `composition/inputQueue.test.ts` covers actual user SendTurn and Retry after both command and resulting-fingerprint failures; `engine/sessionBoundary.test.ts` verifies Session-scoped wakes and unchanged Client feed contents.

Autonomous starts participate in `HARNESS_EVENTS` as `HTurnStarted`. The session view records autonomous origin; SendTurn while that Turn is Working commits an empty batch and steers the existing run. Engine race tests cover both native-start/user-command commit orders and native-to-recorded Turn correlation. Background inactivity expiry uses the existing Idle → Dormant lifecycle, with timer activity and reason checked in Engine tests.
