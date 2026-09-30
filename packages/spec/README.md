# @polaris/spec

A formal model of how Polaris turns commands into committed events and how every Client comes to see exactly those events, written in [Quint](https://quint-lang.org) (TLA+ semantics, checked with Quint's simulator and with Apalache). Linear: ENG-209.

It covers the event store's group commit, receipts and gapless sequence (`apps/daemon/src/store/EventStore.ts`), the live hub's bounded subscribers (`store/hub.ts`), the Engine's streams and recovery rule (`apps/daemon/src/engine/streams.ts`, `recovery.ts`), approvals, Archive and late Harness reports (the session machine, `engine/session.ts`), and the Client's resumable feeds (`packages/client/src/resume.ts`). The same properties are tested against the real code by the model-based tests in `apps/daemon/src/verification/`.

| File | What |
|---|---|
| `polaris.qnt` | The model, its properties, and its instances: `current` (the code as it is), `finding1` / `finding2` / `finding3` (the code before each finding's fix, kept as mutants that must still violate `safety`) and `small` (for Apalache). |
| `polaris_test.qnt` | Scenario tests: interleavings written out by hand (group commit, retry after a crash, answer races, withdrawal races, restart, a dropped subscriber, the host feed, Archive, late approval requests), and one per finding against its mutant. |
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
| `decideClient` | the session machine (`engine/session.ts`, driven by `decider.ts`): `SendTurn`, `Continue`, `Retry` (only after a Failed Turn, as a new Turn; the spec leaves out its prompt), `RespondToApproval`, `ArchiveSession` (`session.archive`: refused with a Turn in flight in every state), `UnarchiveSession` |
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

Each finding's instance (`finding1`, `finding2`, `finding3`) is the code before its fix; `bun run spec` checks that the simulator still finds its violation, so a property that stops guarding a finding is noticed.

**Liveness.** `feedsCatchUp` (`fairness implies eventually(always(caughtUp))`): under weak fairness of `restart`, `commitBatch`, `publishBatch` and every feed's `subscribe` / `readCut` / `deliver` / `streamEnds`, with Clients, Harnesses and crashes acting finitely often (bounded by `MAX_LOG` and `MAX_CRASHES`), every feed eventually sees its whole stream. It is stated in the spec but not model-checked (Apalache's temporal checking does not reach the depth this needs; see "Numbers"). The model-based tests check it on the real code at the end of every run: with every Client reading again, each feed must catch up. In `finding1`, it is false for the host feed.

**Environment assumptions.** A Harness reports items and the end of a Turn only for the Turn it runs, until it ends it (`harnessReports`' guards). It may ask for approval late: after its Turn ended, and any report may be decided after later decisions ended its Turn or started another (the report carries its Turn's number, which the decider compares, as the code compares `turnId`s). Request ids are fresh. Sessions exist from the start, Dormant (`StartSession` is a `SendTurn`).

### What it leaves out, on purpose

- Starting (counted as Working), In Terminal, the Failed that a Harness exit or `session.fail` causes (a failed Turn's end is modelled), Forks, Workspaces, Worktrees, checkpoints, cursors, renames, attachments, Steer, Interrupt, permission modes, Models and effort (`SetModel`, `SessionModelChanged`: refused while a Turn is in flight, so it never interleaves with one, and it changes no Turn status, Session State or approval), Subagents (`SubagentStarted`, `SubagentEnded` and a Subagent's own items: they change no Turn status, Session State or approval, and a Subagent that outlives its Turn ends with the Harness at the latest, like a pending approval; `apps/daemon/src/engine/session.subagents.test.ts` checks the rules), the idle timeout (→ Dormant) and the upgrade hand-off. None of them changes how events are committed or delivered. Archive and Unarchive are modelled; since Starting counts as Working, "Archive with a Turn in flight" in the spec stands for the Starting and In Terminal cases the code accepted before finding 2's fix (`ARCHIVE_IGNORES_TURN`). Interrupt is still left out (it interacts with approvals like Archive; a later extension).
- Ephemeral items (`Delta`, `ItemProgress`): they are never sequenced and are only buffered below half capacity, so they cannot drop a subscriber (the store model-based test checks that).
- Transaction failures other than a crash, and the one-by-one retry of a failed batch. An OS crash that rolls back the last WAL commits (`synchronous = NORMAL`): the model's database never loses a commit.
- Recovery runs as one atomic step. In the code it is one commit per session; a crash in between leaves some sessions recovered, and the next start recovers the rest, which ends in the same state.
- The RPC transport: a stream is a list of items in flight; flow control is the hub buffer.
- The feed's cache and `maxCachedEvents` (a fresh Snapshot resets the view, which the model covers).

## Model-based tests (the real code)

`apps/daemon/src/verification/` holds fast-check model-based tests that drive the real code through its public APIs and check the same properties after every step:

- `store.model.test.ts`: the real `EventStore` on a SQLite file. Bursts of concurrent commits (fresh ids, retries, duplicates within a batch, Daemon events; accepted, rejected, empty and defective decisions) whose start order and batching `fc.scheduler` picks; subscribers with a buffer of 1–4 that pause and resume and follow the store's contract (subscribe, cut, replay, resume from the last sequence when dropped); ephemeral output; crashes mid-burst and between bursts. A reference model replays the store's decisions in the order it took them and predicts every answer exactly.
- `engine.model.test.ts`: the real `Engine` with the fake Harness, two devices, and the Client's real `makeFeed` for the host stream and both session streams of each device (behind a detached "network" so a stalled Client backs up into the Daemon's hub buffer). Bursts of commands (including Archive and Unarchive) and Harness events (including late approval requests for a Turn that ended), answer races, stalls, disconnects and crashes. A reference decider checks every command's recorded events against the log right before them, and every rejection against some state while it was in flight; approval, recovery and no-auto-continue checks as in the spec; each recorded request is for its session's Turn in flight, nothing is pending and no session Working without one, and no Archived session holds one; the read model against a fold of the log; each feed against its stream and each Snapshot against the log at its sequence; every feed catches up at the end. The reference fold and decider are in `engine.reference.testing.ts`, the Engine, fake Harness and Client feeds it drives in `engine.world.testing.ts`, and the per-step checks in `engine.invariants.testing.ts`.
- `findings.test.ts`: the bugs below, as regression tests (a new finding that cannot be fixed at once goes there as `test.todo`).

`POLARIS_PBT_RUNS` sets the number of runs (CI: 25 for the store, 12 for the Engine), `POLARIS_PBT_SEED` replays a seed fast-check printed, and `POLARIS_PBT_STATS=1` prints what the runs reached.

## Trace validation

`engine.model.test.ts` writes each run's committed log, the commands sent and the restart points when `POLARIS_TRACE_DIR` is set (Interrupt is then left out, as the spec has no Interrupt). `scripts/replay.ts` maps each log to the spec's events, splits it into the decisions that produced it (a Client command, a Harness report, a restart), and writes a Quint run that replays exactly those decisions with the spec's actions; `quint test` then checks the spec records the same events in the same order, with `safety` after every decision. The replay found finding 3 and showed that recovery visits sessions in the order the read model loads them (by last update), not creation order (harmless; the spec takes the order as a parameter, `restartIn`).

## Numbers

Measured on an Apple M-series laptop.

| Check | Bound | Result |
|---|---|---|
| `quint test` | 12 scenarios, and one per finding's mutant | pass (< 1 s each) |
| `quint run --main=current --invariant=safety` | 3000 traces × 60 steps (180k steps), seed `0x5eed` | no violation, ~25 s; every witness reached (dropped subscriber in 36% of traces, resume after a drop 1.5%, answer race 0.07%, restart withdrawing an approval 0.13%, Continue 2%, Retry 1%, Archive 48%, Archive refused 11%, Unarchive 7%, a late request about to be decided 14%) |
| | 20000 traces × 60 steps | no violation, ~145 s |
| `quint run --main=finding1 --invariant=hostFeedCanProgress` | | violation in the first trace |
| `quint run --main=finding2 --invariant=archivedIsClosed` | | violation in the first traces |
| `quint run --main=finding3 --invariant=approvalsNeedATurn` | | violation in the first traces |
| `quint verify --main=small --invariant=safety` (Apalache 0.56.1) | 3 steps | no violation, ~38 s (the spec before Archive and late requests: ~17 s on the same machine) |
| | 4 steps | did not finish: out of the default 4 GB heap after 9 min, still running after 33 min with 16 GB. The spec before these changes (`2783643`) did not finish 4 steps within 10 min on the same machine either, so the ~55 s measured earlier no longer reproduces here; CI runs it report-only |
| Mutants (a subscriber that skips instead of dropping; no batch-local receipts; no withdrawal on restart; no pending check on answers; no client dedupe *and* no live cut filter) | 3000 traces | each violates `safety` within seconds (measured before Archive was modelled) |
| Store model-based test | 1000 runs | pass, ~8 s (CI: 25 runs) |
| Engine model-based test | 500 runs | pass, ~24 s (CI: 12 runs); 145 Archives, 14 Unarchives, 41 late requests |
| Trace validation | 150 Engine runs, 1230 decisions, 1787 spec events (9 accepted Retries) | all conform |

Archive and Unarchive (on by default) and late requests make the simulator spend traces on Archived sessions: a dropped subscriber, an answer race and a restart withdrawing an approval are reached less often than before (66% → 40%, 0.3% → 0.07%, 0.2% → 0.17%), but still in every run of `bun run spec`, which fails if a witness is never reached.

Apalache is exhaustive only up to its step bound, and most interesting interleavings need 8–15 steps, so the simulator (random, deep) and the model-based tests (real code) carry most of the weight; Apalache guards the shallow corner cases.

## Findings

All three are fixed on `fix/verification-findings`; each has a regression test in `findings.test.ts`, a property in `safety` and a mutant instance (`finding1`–`finding3`) the simulator must still catch.

1. **The Client's host feed stalled after the first Turn** (`packages/client/src/HostConnection.ts`). `HostConnection` opened the host feed with `gapless: true`, but the Daemon's host stream leaves out session-only events (`TurnItemCompleted`, `CheckpointRecorded`), so its sequences have gaps. At the first one the feed reopened from its last sequence; the replay had the same gap; it reopened again, in a loop with no delay, never advancing past the first checkpoint or item of any Turn and hammering the Daemon with resubscribes (over 5000 in 250 ms). Spec: `hostFeedCanProgress`. **Fix**: the host feed opens with `gapless: false` (the sequence dedupe is enough: a dropped subscriber's stream ends, it is never skipped), and `makeFeed` backs off reopens that make no progress (25 ms doubling to 5 s), so no stream can make a feed loop hot again (`client.test.ts`).
2. **Archiving an In Terminal session mid-Turn left the Turn working and its approvals pending forever** (`engine/session.ts`: the top-level `session.archive` handler, and `daemon.recover` skipping Archived). Archive was refused with a Turn in flight only in the `live` states; In Terminal, Starting, Dormant and Failed archived without checking, nothing ended the Turn or withdrew its requests, and recovery skips Archived sessions. Spec: `archivedIsClosed` (Archive was not modelled before; with it, the mutant fails in the first traces). **Fix**: Archive is refused while a Turn is in flight in every state, with the live states' reason ("interrupt the Turn in flight before archiving"), and withdraws anything still pending. Refusing rather than ending the Turn: Archive never discards a Turn the user may still be watching in the terminal UI, one guard covers every state, and Interrupt (in Polaris or the terminal UI) always ends the Turn first. Recovery now closes what an older log left open in an Archived session (the Turn Interrupted, its requests withdrawn) and keeps it Archived.
3. **A late approval request left a session Working with no Turn** (`engine/session.ts`, `harness.approvalRequested`). The machine recorded a Harness's request whatever its Turn's state. One that arrived after the Turn ended put the session in Needs You with no Turn; answering it moved it to Working, still with no Turn, and `SendTurn` was refused until a restart. Found by trace validation. The spec could already reach it (a request queued before its Turn's end, decided after it), but no property looked. Spec: `approvalsNeedATurn`, `workingHasATurn`, with Harness reports now carrying their Turn and allowed to arrive late. **Fix**: a request for a Turn that is not the Turn in flight is ignored, as a `TurnEnded` for a Turn that is not working already was, and the last answer or withdrawal moves to Working only with a Turn in flight.

## Open issues

- The spec does not model Interrupt, In Terminal, Starting (counted as Working), Forks or the upgrade hand-off.
- Apalache no longer finishes 4 steps of `small` locally (neither does the spec from before these changes), so `bun run spec -- --verify` and CI's report-only step will likely run out of memory or time. Either lower CI's bound to 3 steps or slim `small` down (e.g. a constant that leaves Archive and late requests out of it).
- `feedsCatchUp` is stated, not model-checked; the model-based tests check it on the real code.
- The model-based tests "crash" the Daemon by disposing its layer, which lets an in-flight transaction finish; a hard kill (a subprocess and `SIGKILL`) would also cover commits decided but not written.
- A late approval request is dropped without an answer to the Harness. That is right for the Turn-scoped requests the drivers send today; a Harness that asked about an ended Turn and blocked on the answer would wait until its next Turn or exit.
- Interrupt with no Harness running (`turn.interruptUnattended`) moves an In Terminal session to Dormant, even though its terminal UI may still be open (the Claude hand-off follows the TUI without a Harness). It is how a user ends a Turn the TUI left open before archiving; a follow-up could keep In Terminal there.
- Checked against the ENG-210 session machine (merged at `1285069`).
