# Standalone session recovery never continues a Turn

When the Daemon starts, the Engine sends the session machine's `daemon.recover` (cause `restart`) to every session before it serves anything. Right before an upgrade exec, `prepareForUpgrade` stops the Harnesses that live in the Daemon process (`liveCoAttach: false`, i.e. Claude) and sends the same input with cause `upgrade`. The rule: a Turn in flight ends Interrupted and its session Needs You (reason `interrupted`, so the Client offers Continue); pending approvals are withdrawn; Failed stays Failed; other live sessions go Dormant and resume from their cursor on their next Turn. For standalone sessions, only the user's `Continue` continues a Turn. Delegated Attempts have the bounded exception below.

## Why

A Turn cut off by a restart may have been half way through edits, commands or an approval the user was about to answer. Continuing it on its own would act on the user's behalf after an event they may not know happened, possibly hours later. Needs You with Continue puts the decision in front of the user, with the Turn's output so far.

The upgrade path applies the same rule before the exec rather than after it, because the in-process Harnesses die with the old process. Codex threads live in the shared app-server, which survives the exec, so they are left running and the recovery on start handles whatever needs it.

## Considered Options

- **Continue the interrupted Turn automatically after a restart.** Rejected for the reason above.
- **Leave the session Working and let the Harness reconnect.** Rejected: the Harness process is gone, so the session would show a Turn in flight that nothing is running.

## Consequences

- If an upgrade exec fails, nothing is undone: the stopped sessions stay Dormant or Needs You and resume on their next Turn or Continue, exactly as after a restart.
- A restart while a session is In Terminal moves it like any live session and does not restore the terminal follower (a known gap, see `apps/daemon/src/store/README.md`).
- The rule lives in one place, the session machine (`apps/daemon/src/engine/session.ts`); it is specified as `recoverSession` / `restartIn` in `packages/spec/polaris.qnt`.


## Amendment: one automatic Continue for a delegated Attempt (ENG-243)

Constellations v1 already delegates a Task to a worker. When a restart or upgrade
interrupts that worker's Turn, the owner may automatically Continue it once:
"The Daemon restarted; continue your Task". It journals
`AttemptRecoveryContinued` with cause `recover`, the Attempt, Turn and durable
interruption ID. The continuation and its durable marker must be one idempotent
decision, so a crash between recording and sending cannot generate another Turn.
This resumes the same Attempt; it does not start a competing one on that session.

A second interruption becomes attention. Re-folding the log consumes the marker,
so another restart cannot reset the allowance. A settled or non-latest Attempt,
a user-interrupted Turn, an unresolved worker approval, a standalone session and
the Lead's own session are not eligible. A Host becoming stale never triggers
Continue or settlement; only the user can approve worker approvals. The existing
Session State machine still governs whether a Continue may run.

The owner makes the graph decision; for a remote worker the Desktop App relays
it to the worker's Daemon with a stable decision ID (ADR 0011). A disconnected
app or unavailable owner delays delivery and cannot grant another allowance.
Recovery restarts notification coalescing from zero, keeping queued IDs intact.

This narrow exception lets already delegated work survive one infrastructure
interruption. It does not change the standalone rule: an interrupted standalone
Turn still Needs You, and only the user's Continue resumes it. A Lead failure
also needs Continue the Lead or Hand over; it is not a worker auto-Continue.

`packages/spec/constellations.qnt` specifies `interrupt`, `recover`,
`recoveryAtMostOnce` and its scenario test; the original standalone rule remains
in `polaris.qnt`. The engine slice must implement both through the session and
Constellation deciders and test crash/replay around the durable marker.

The Engine records `AttemptInterrupted` in the same Session recovery commit,
before withdrawing pending approvals. Eligibility, the interrupted Turn ID and
its ending timestamp are durable. Startup re-folds that proof for upgrades that
already ended the Turn; a later user interruption cannot reuse it. Resume
acquires the working slot before consuming the allowance. Remote auto-Continue
remains unavailable until the worker provides verified interruption and continued
Turn receipts; an owner enqueue is not that proof.
