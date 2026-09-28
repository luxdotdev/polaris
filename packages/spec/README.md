# @polaris/spec

A formal model of how Polaris turns commands into committed events and how every Client comes to see exactly those events, written in [Quint](https://quint-lang.org) (TLA+ semantics, checked with Quint's simulator and with Apalache). Linear: ENG-209.

It covers the event store's group commit, receipts and gapless sequence (`apps/daemon/src/store/EventStore.ts`), the live hub's bounded subscribers, the Engine's streams and recovery rule (`apps/daemon/src/engine/Engine.ts`), approvals (`decider.ts`), and the Client's resumable feeds (`packages/client/src/resume.ts`). The same properties are tested against the real code by the model-based tests in `apps/daemon/src/verification/`.

| File | What |
|---|---|
| `polaris.qnt` | The model, its properties, and three instances: `current` (the code as it is), `fixed` (the host feed without its gap check) and `small` (for Apalache). |
| `polaris_test.qnt` | Scenario tests: interleavings written out by hand (group commit, retry after a crash, answer races, withdrawal races, restart, a dropped subscriber, the host feed). |
| `scripts/check.ts` | Runs every check (`bun run spec`). |
| `scripts/replay.ts` | Trace validation: replays logs the real Engine committed through the model (below). |

## Running it

```sh
bun run spec                                       # typecheck, scenario tests, simulator (~45 s)
bun run spec -- --samples 20000                    # a longer simulation
bun run spec -- --verify                           # also Apalache (Java 17+), up to 4 steps
bun run spec -- --verify --steps 5                 # deeper; see "Numbers" for the cost
cd packages/spec && npx quint run polaris.qnt --main=current --invariant=hostFeedCanProgress   # finding 1's counterexample
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
| `decideClient` | the session machine (`engine/session.ts`, driven by `decider.ts`): `SendTurn`, `Continue`, `RespondToApproval` |
| `decideHarness` | the session machine's `harness.*` events (`session.ts`, fed by `Engine.ts`): `ApprovalRequested`, `ApprovalWithdrawn`, `ItemCompleted`, `TurnEnded` |
| `recoverSession` / `restartIn` | the machine's `daemon.recover`, run by `Engine.ts` on start, before the Engine serves anything |
| `queue` + `clientSends` / `clientRetries` / `harnessReports` | `EventStore.commit` pushing onto `queued` (from `Engine.dispatch` and `recordFor`) |
| `commitBatch` | the drain (`drain` → `writeBatch` → `runBatch`): every queued command, decided in order against the model the previous ones produced, in one transaction; a duplicate id within the batch is answered from the batch |
| `publishBatch` | after the transaction: `Ref.set`, `hub.publish`, `Deferred.done` (the ack), and the reactor forked by `dispatch` |
| `reactorRuns` | `react` → `runTurn` → `openHarness` (only if the Turn is still working) |
| `subs[(client, stream)]`, `subscribe` / `readCut` | `subscribeHost` / `subscribeSession`: `store.subscribe` first, then the model's sequence as the cut, a Snapshot or a replay of `(after, cut]`, then `Synchronized` |
| `Sub.buf`, `offer`, `dropped`, `streamEnds` | `makeHub`: the bounded per-subscriber queue, dropped (not skipped) when full; its stream ends once drained |
| `deliver` | the live filter `sequence > cut`, then the feed's `handle` |
| `feeds`, `handle` | `makeFeed`: `lastSequence`, dedupe of `sequence <= last`, a Snapshot resets, and the `gapless` reopen |
| `HOST_FEED_GAPLESS` | `HostConnection.ts` opening the host feed with `gapless: true` |
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
- `interruptedNeedsYou`: an Interrupted Turn leaves its session Needs You.

`hostFeedCanProgress` (outside `safety`) says a host feed can still advance; it fails in `current` (finding 1).

**Liveness.** `feedsCatchUp` (`fairness implies eventually(always(caughtUp))`): under weak fairness of `restart`, `commitBatch`, `publishBatch` and every feed's `subscribe` / `readCut` / `deliver` / `streamEnds`, with Clients, Harnesses and crashes acting finitely often (bounded by `MAX_LOG` and `MAX_CRASHES`), every feed eventually sees its whole stream. It is stated in the spec but not model-checked (Apalache's temporal checking does not reach the depth this needs; see "Numbers"). The model-based tests check it on the real code at the end of every run: with every Client reading again, each feed must catch up. In `current`, it is false for the host feed (finding 1).

**Environment assumptions.** A Harness reports items, approval requests and the end of a Turn only for the Turn it runs, until it ends it (`harnessReports`' guards). Request ids are fresh. Sessions exist from the start, Dormant (`StartSession` is a `SendTurn`).

### What it leaves out, on purpose

- Starting (counted as Working), In Terminal, Failed, Archived, Forks, Workspaces, Worktrees, checkpoints, cursors, renames, attachments, Steer, Interrupt, permission modes, the idle timeout (→ Dormant) and the upgrade hand-off. None of them changes how events are committed or delivered; Interrupt and Archive interact with approvals (finding 2 is about Archive) and are left for a later extension. Since ENG-210 an Archived session ignores late Harness reports and unattended interrupts instead of leaving Archived; the spec never assumed otherwise (it has no Archived state), and the model-based tests never archive.
- Ephemeral items (`Delta`, `ItemProgress`): they are never sequenced and are only buffered below half capacity, so they cannot drop a subscriber (the store model-based test checks that).
- Transaction failures other than a crash, and the one-by-one retry of a failed batch. An OS crash that rolls back the last WAL commits (`synchronous = NORMAL`): the model's database never loses a commit.
- Recovery runs as one atomic step. In the code it is one commit per session; a crash in between leaves some sessions recovered, and the next start recovers the rest, which ends in the same state.
- The RPC transport: a stream is a list of items in flight; flow control is the hub buffer.
- The feed's cache and `maxCachedEvents` (a fresh Snapshot resets the view, which the model covers).

## Model-based tests (the real code)

`apps/daemon/src/verification/` holds fast-check model-based tests that drive the real code through its public APIs and check the same properties after every step:

- `store.model.test.ts`: the real `EventStore` on a SQLite file. Bursts of concurrent commits (fresh ids, retries, duplicates within a batch, Daemon events; accepted, rejected, empty and defective decisions) whose start order and batching `fc.scheduler` picks; subscribers with a buffer of 1–4 that pause and resume and follow the store's contract (subscribe, cut, replay, resume from the last sequence when dropped); ephemeral output; crashes mid-burst and between bursts. A reference model replays the store's decisions in the order it took them and predicts every answer exactly.
- `engine.model.test.ts`: the real `Engine` with the fake Harness, two devices, and the Client's real `makeFeed` for the host stream and both session streams of each device (behind a detached "network" so a stalled Client backs up into the Daemon's hub buffer). Bursts of commands and Harness events, answer races, stalls, disconnects and crashes. A reference decider checks every command's recorded events against the log right before them, and every rejection against some state while it was in flight; approval, recovery and no-auto-continue checks as in the spec; the read model against a fold of the log; each feed against its stream and each Snapshot against the log at its sequence; every feed catches up at the end.
- `findings.test.ts`: the bugs below, as `test.todo`.

`POLARIS_PBT_RUNS` sets the number of runs (CI: 25 for the store, 12 for the Engine), `POLARIS_PBT_SEED` replays a seed fast-check printed, and `POLARIS_PBT_STATS=1` prints what the runs reached.

## Trace validation

`engine.model.test.ts` writes each run's committed log, the commands sent and the restart points when `POLARIS_TRACE_DIR` is set (Interrupt is then left out, as the spec has no Interrupt). `scripts/replay.ts` maps each log to the spec's events, splits it into the decisions that produced it (a Client command, a Harness report, a restart), and writes a Quint run that replays exactly those decisions with the spec's actions; `quint test` then checks the spec records the same events in the same order, with `safety` after every decision. The replay found finding 3 and showed that recovery visits sessions in the order the read model loads them (by last update), not creation order (harmless; the spec takes the order as a parameter, `restartIn`).

## Numbers

Measured on an Apple M-series laptop.

| Check | Bound | Result |
|---|---|---|
| `quint test` | 9 scenarios | pass (< 1 s) |
| `quint run --main=current --invariant=safety` | 3000 traces × 60 steps (180k steps), seed `0x5eed` | no violation, ~19 s; every witness reached (dropped subscriber in 66% of traces, resume after a drop 1.8%, answer race 0.3%, restart withdrawing an approval 0.2%) |
| `quint run --main=fixed --invariants safety hostFeedCanProgress` | same | no violation, ~16 s |
| `quint run --main=current --invariant=hostFeedCanProgress` | | violation in the first trace (finding 1; a 16-step scenario in `polaris_current_test`) |
| `quint verify --main=small --invariant=safety` (Apalache 0.56.1) | 4 steps | no violation, ~55 s |
| | 5 steps | no violation, ~8 min |
| `quint verify --main=fixed` | 4 steps | no violation, ~105 s; 6 steps ran out of a 4 GB heap after 22 min |
| Mutants (a subscriber that skips instead of dropping; no batch-local receipts; no withdrawal on restart; no pending check on answers; no client dedupe *and* no live cut filter) | 3000 traces | each violates `safety` within seconds |
| Store model-based test | 1000 runs | pass, ~6.5 s (CI: 25 runs) |
| Engine model-based test | 300 runs | pass, ~27 s (CI: 12 runs) |
| Trace validation | 150 Engine runs, 1289 decisions, 2139 spec events | all conform, ~55 s |

Apalache is exhaustive only up to its step bound, and most interesting interleavings need 8–15 steps, so the simulator (random, deep) and the model-based tests (real code) carry most of the weight; Apalache guards the shallow corner cases.

## Findings

1. **The Client's host feed stalls after the first Turn** (`packages/client/src/HostConnection.ts:394`). `HostConnection` opens the host feed with `gapless: true`, but the Daemon's host stream leaves out session-only events (`TurnItemCompleted`, `CheckpointRecorded`), so its sequences have gaps. At the first one the feed reopens from its last sequence; the replay has the same gap; it reopens again, in a loop with no delay. The host feed never advances past the first checkpoint or item of any Turn and hammers the Daemon with resubscribes (over 5000 in 250 ms in the test). Spec: `hostFeedCanProgress`, `polaris_current_test`. Test: `findings.test.ts`. Fix: `gapless: false` for the host feed (sequence dedupe is enough), or make the host stream gapless.
2. **Archiving an In Terminal session mid-Turn leaves the Turn working and its approvals pending forever** (`engine/session.ts`: the top-level `session.archive` handler, and `daemon.recover` skipping Archived). Archive is refused in the `live` states (Idle / Working / Needs You) with a Turn in flight, but the top-level handler used in In Terminal (and Starting, Dormant, Failed) archives without checking for one; nothing ends the Turn or withdraws its requests, and recovery skips Archived sessions, so after a restart the archived session still has a `working` Turn and a pending approval. Test: `findings.test.ts`. Fix: refuse Archive while any Turn is in flight, or end it and withdraw on Archive (and recover Archived sessions too).
3. **A late approval request leaves a session Working with no Turn** (`engine/session.ts`, `harness.approvalRequested`). The machine records a Harness's request whatever its Turn's state. One that arrives after the Turn ended puts the session in Needs You with no Turn; answering it moves it to Working, still with no Turn, and `SendTurn` is then refused until a restart. Found by trace validation. Test: `findings.test.ts`. Fix: ignore (or withdraw at once) a request whose `turnId` is not the working Turn, as `TurnEnded` already does.

## Open issues

- The spec does not model Interrupt, Archive, In Terminal, Forks or the upgrade hand-off; extending it to Interrupt and Archive would have caught finding 2 directly.
- `feedsCatchUp` is stated, not model-checked; the model-based tests check it on the real code.
- The model-based tests "crash" the Daemon by disposing its layer, which lets an in-flight transaction finish; a hard kill (a subprocess and `SIGKILL`) would also cover commits decided but not written.
- Checked against the ENG-210 session machine (merged at `1285069`): all model-based tests, trace validation (150 runs) and the three findings reproduce unchanged. The tests only use `Engine.dispatch`, the streams and the store's read side, so later machine refactors should not break them.
