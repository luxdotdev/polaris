# @polaris/spec

A formal model of how Polaris turns commands into committed events and how every Client comes to see exactly those events, written in [Quint](https://quint-lang.org) (TLA+ semantics, checked with Quint's simulator and with Apalache). Linear: ENG-209.

It covers the event store's group commit, receipts and gapless sequence (`apps/daemon/src/store/EventStore.ts`), the live hub's bounded subscribers (`store/hub.ts`), the Engine's streams and recovery rule (`apps/daemon/src/engine/streams.ts`, `recovery.ts`), approvals, Archive and late Harness reports (the session machine, `engine/session.ts`), accepting Turns and the review-only events (M2 Review, ENG-217), and the Client's resumable feeds (`packages/client/src/resume.ts`). The same properties are tested against the real code by the model-based tests in `apps/daemon/src/verification/`.

| File | What |
|---|---|
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
| `decideHarness` | the session machine's `harness.*` events (`session.ts`, fed by `supervisor.ts`): `ApprovalRequested` (only for the Turn in flight; `approvalRequested`), `ApprovalWithdrawn`, `ItemCompleted`, `TurnEnded` (only for a working Turn; Archived records it without leaving Archived; `HTurnFailed` is a `TurnEnded` with status `failed`, which moves to Failed) |
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
| Walkthrough metadata | Optional `walkthrough` / `deltaWalkthrough` on `RiskSummaryStarted` and `RiskSummaryLayerChanged` use the existing review-only event path (`store/review.ts`). Ready walkthrough heads stay cached across explicit Reviewer refreshes. Metadata changes preserve the Reviewer layer; no new event tags, receipt, ack, feed, or Session State semantics. Write/Retry starts a normal read-only Agent Session with `StartSession`; Stop uses the existing `Interrupt` machine command. Older Clients ignore optional metadata and do not advertise `review.walkthrough`. |
| `CAPACITY` | `StoreConfig.subscriberCapacity` |

**Properties** (all in `safety`, checked after every step):

- `gaplessLog`: sequences are 1, 2, 3, … with no gap.
- `feedsAreCommittedPrefixes`: every Client's view of every stream is a prefix of that stream's committed sequence: no gaps, no duplicates, no reordering, across drops, reconnects and restarts.
- `answersAreCommitted`: anything a Client heard back is backed by a durable receipt, and an `Ok(n)` / `Dup(n)` by committed events up to `n` with its id. (Acks come only after commit.)
- `retriesApplyOnce` and `commandEventsContiguous`: a command id is decided at most once, however often it is retried, before or after a crash; its events are one contiguous block.
- `approvalsCloseOnce`: each request is resolved or withdrawn at most once, and only after it was opened.
- `firstAnswerWins`: at most one answer to a request is accepted, and the recorded `resolvedBy` is that device.
- `restartWithdrawsApprovals`: after a restart no request from before it is pending.
- `noAutoContinue`: every `TurnStarted` comes from a Client command, and a Harness runs after a restart only if a command after the restart started a Turn.
- `interruptedNeedsYou`: an Interrupted Turn leaves its session Needs You (until a Client continues or replaces it, or archives the session).
- `approvalsNeedATurn`: an approval is pending only while a Turn is in flight (finding 3).
- `workingHasATurn`: a session is Working only with a Turn in flight (finding 3).
- `archivedIsClosed`: an Archived session holds no Turn in flight and no pending approval (finding 2). With `restartWithdrawsApprovals` and the recovery rule, nothing stays open after a restart either.
- `hostFeedCanProgress`: the next host-stream event after a host feed's last one never makes it reopen (finding 1). Stated through the feed's own `handle`, so it is not vacuous when the gap check is off.
- `acceptedNeverInFlight`: acceptance never passes the Turns that exist, and an accepted Turn is never in flight again (finding 4).
- `acceptedOnlyForward`: each session's `TurnsAccepted` events only move forward.

Each finding's instance (`finding1` … `finding4`) is the code before its fix; `bun run spec` checks that the simulator still finds its violation, so a property that stops guarding a finding is noticed.

**Liveness.** `feedsCatchUp` (`fairness implies eventually(always(caughtUp))`): under weak fairness of `restart`, `commitBatch`, `publishBatch` and every feed's `subscribe` / `readCut` / `deliver` / `streamEnds`, with Clients, Harnesses and crashes acting finitely often (bounded by `MAX_LOG` and `MAX_CRASHES`), every feed eventually sees its whole stream. It is stated in the spec but not model-checked (Apalache's temporal checking does not reach the depth this needs; see "Numbers"). The model-based tests check it on the real code at the end of every run: with every Client reading again, each feed must catch up. In `finding1`, it is false for the host feed.

**Environment assumptions.** A Harness reports items and the end of a Turn only for the Turn it runs, until it ends it (`harnessReports`' guards). It may ask for approval late: after its Turn ended, and any report may be decided after later decisions ended its Turn or started another (the report carries its Turn's number, which the decider compares, as the code compares `turnId`s). Request ids are fresh. Sessions exist from the start, Dormant (`StartSession` is a `SendTurn`).

### What it leaves out, on purpose

- Starting (counted as Working), In Terminal, the Failed that a Harness exit or `session.fail` causes (a failed Turn's end is modelled), Forks, Workspaces, Worktrees, checkpoints, cursors, renames, attachments, Steer, Interrupt, permission modes, Models and effort (`SetModel`, `SessionModelChanged`: refused while a Turn is in flight, so it never interleaves with one, and it changes no Turn status, Session State or approval), Subagents (`SubagentStarted`, `SubagentEnded` and a Subagent's own items: they change no Turn status, Session State or approval, and a Subagent that outlives its Turn ends with the Harness at the latest, like a pending approval; `apps/daemon/src/engine/session.subagents.test.ts` checks the rules), context usage (`SessionContextUsed`: a Harness report committed like a rename, with no command, and left out of the Host stream; it changes no Turn status, Session State or approval), the idle timeout (→ Dormant) and the upgrade hand-off. None of them changes how events are committed or delivered. Archive and Unarchive are modelled; since Starting counts as Working, "Archive with a Turn in flight" in the spec stands for the Starting and In Terminal cases the code accepted before finding 2's fix (`ARCHIVE_IGNORES_TURN`). Interrupt is still left out (it interacts with approvals like Archive; a later extension).
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
- Apalache no longer finishes 4 steps of `small` locally (neither does the spec from before these changes), so `bun run spec -- --verify` and CI's report-only step will likely run out of memory or time. Either lower CI's bound to 3 steps or slim `small` down (e.g. a constant that leaves Archive and late requests out of it).
- `feedsCatchUp` is stated, not model-checked; the model-based tests check it on the real code.
- The model-based tests "crash" the Daemon by disposing its layer, which lets an in-flight transaction finish; a hard kill (a subprocess and `SIGKILL`) would also cover commits decided but not written.
- A late approval request is dropped without an answer to the Harness. That is right for the Turn-scoped requests the drivers send today; a Harness that asked about an ended Turn and blocked on the answer would wait until its next Turn or exit.
- Interrupt with no Harness running (`turn.interruptUnattended`) moves an In Terminal session to Dormant, even though its terminal UI may still be open (the Claude hand-off follows the TUI without a Harness). It is how a user ends a Turn the TUI left open before archiving; a follow-up could keep In Terminal there.
- Checked against the ENG-210 session machine (merged at `1285069`).

## Constellations v1 (C1-P, ENG-236/ENG-243/ENG-244)

`constellations.qnt` is the reference model for the Constellation contract in
`packages/protocol/src/constellation/` and ADRs 0004/0011. It runs alongside the
existing store/session spec. `constellations_test.qnt` contains 18 command/race
scenarios and 16 malformed-event probes that must violate the corresponding
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
| `planEvents`, `opEvents`, `validGraph` | `ConstellationCommand.Plan`, `PlanOperation`: atomic Add/Edit/Cancel with revisions; reject cycles, missing/canceled deps and cancellation with dependents |
| `start`, `current`, `change`, `latest`, `taskState` | `AttemptStarted`, Attempt revision, linked `AttemptCause.ref`, `TaskProjection`; engine decider folds the graph rather than persisting Task state |
| Observed worker liveness | `TaskProjection.liveness` and `ConstellationStreamItem.LivenessChanged` are runtime observations, not graph events. The live item is unsequenced/unpersisted like session item progress; it changes no command, receipt, revision, resume cursor or recovery decision. Unknown facts are null in required Snapshot projections. Elapsed time is derived from observed timestamps without Daemon timers. |
| `claim`, `accept`, `reject`, `stop`, `harnessFail` | worker Claim, ReviewAction, AttemptClaimed/Accepted/Rejected/Settled; Claim requires clean branch/current revision and acceptance requires the claimed head |
| Fetched branches | `ConstellationStreamItem.BranchFetched` and required Snapshot `TaskProjection.branchFetched` observe an exact claimed commit at the owner Polaris ref. They carry no sequence or graph revision; Accept additionally probes the actual merged Lead head. Bundles stream through existing BlobChannels without retaining bundle-sized buffers. |
| `promote` | decider-only `GatePromoted`, counting latest accepted Attempts, not Claims or mechanical settles |
| `ask`, `finish`, `deliver` | NotificationQueued and LeadNotified; committed notification IDs, one durable digest Turn, retained across restart and handover |
| `handover`, `setState` | atomic LeadChanged and the planning/running/paused/completed/archived lifecycle; workers are unchanged |
| `commit`, `enqueue`, `relay`, `availability` | owner-only events, ConstellationOutboxEntry stable IDs, app relay and unavailable owner; `transfers/outbox.ts` persists the worker intent, decides under EventStore.commit, and retains apply/refusal receipts. Client `constellation/relay.ts` uses existing HostConnection streams and retries durable packets after reconnect. `transfers/relay.test.ts` covers disconnect after owner commit before receipt saving and refusal replay |
| Lazy runtime activation and codecs | The persisted event shapes and Quint fold are unchanged. `store/eventJson.test.ts` checks canonical per-kind validation, including deferred Constellation payloads and constructor defaults; `constellation/liveness.test.ts` checks a producer captured before provider activation. `transfers/remoteWorking.test.ts` checks that a new Attempt receives its first brief even when its Existing Session has historical Turns; resume depends on that Attempt's startup or an explicit recovery call. |
| `interrupt`, `recover`, `restart` | AttemptRecoveryContinued: one automatic Continue for a delegated Attempt's first infrastructure interruption, with durable replay marker; second interruption is attention |
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

This abstraction leaves out prose, bundled git bytes, receipt output, permission
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
malformed logs. It omits metadata prose and abstracts wire revisions; actual
command refusals, role/revision checks, Harness execution and relay idempotency
remain the engine/harness/resource model-based and integration tests. A passing
abstract simulation alone does not verify those runtime paths.

C1-E's real decider maps to `apps/daemon/src/engine/constellation.ts`; graph/store
reference tests and complete committed-log fixtures are under
`apps/daemon/src/verification/constellation*.test.ts`. The additive
`ClaimApproved`, `ClaimHandedUp` and `AttemptNudged` events advance Attempt
revisions while retaining their state. `reviewMetadataValid` checks that approval
and hand-up occur in Review, nudges occur while working, and each marker occurs
once per Attempt. Role authorization and refused commands remain real decider
tests. `constellation.defaults.get/set` persist user settings outside the graph
journal; `plan.start` snapshots omitted settings before its serialized decision.
The live producer's ephemeral `LivenessChanged` frames have no global sequence
and are outside this committed-log abstraction. Their capability gate, resume
seeding and graph-revision neutrality are covered by the real producer tests.

C1-L implements the delivery runner under `apps/daemon/src/constellation/delivery`,
with timers only for pending Lead-worthy updates (20 s Claims / 5 s blocking Lead
questions). Queued IDs and `LeadNotified` commit with the Session-machine Turn;
worker approvals and questions to the user never wake the Lead.
`LeadHandoverRequested` persists a request without changing the Lead. A later
`LeadChanged.requestId` must match the latest uncancelled request from the current
Lead (`handoverRequestOrdered`); supersession and `LeadHandoverCancelled` invalidate
older completions. The final switch, archive and new header Turn share one commit.
Quint scenarios cover restart, cancellation, supersession and old-Lead delivery.
`WorkerInputDelivered` records one recipient receipt (`inputDeliveredAtMostOnce`);
remote enqueue alone records no delivery. `AttemptStale`/`AttemptFresh` retain
observed intervals across restart without changing Attempt state or revision.
The replay reader maps these journal events. Real runner tests cover coalescing,
Session boundaries, nudge limits, operator authority, peer routing and recovery.
