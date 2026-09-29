# Recovery after a restart or upgrade never continues a Turn

When the Daemon starts, the Engine sends the session machine's `daemon.recover` (cause `restart`) to every session before it serves anything. Right before an upgrade exec, `prepareForUpgrade` stops the Harnesses that live in the Daemon process (`liveCoAttach: false`, i.e. Claude) and sends the same input with cause `upgrade`. The rule: a Turn in flight ends Interrupted and its session Needs You (reason `interrupted`, so the Client offers Continue); pending approvals are withdrawn; Failed stays Failed; other live sessions go Dormant and resume from their cursor on their next Turn. Only the user's `Continue` continues a Turn.

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
