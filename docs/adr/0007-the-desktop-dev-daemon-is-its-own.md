# In dev, the Desktop App runs its own Daemon, apart from the real one

`bun run --cwd apps/desktop dev` connects the local Host to `~/.polaris/daemon.sock` when a Daemon answers there. When none does, it starts one from source (`bun apps/daemon/src/main.ts serve --foreground`) as its own child, with `POLARIS_HOME=$TMPDIR/polaris-desktop-dev` and `POLARIS_BENCH_HARNESS=1`, and stops it when the app quits. `POLARIS_DESKTOP_DAEMON=dev|system` forces either. Packaged builds never start a Daemon: they connect to the installed user service (or report its Connection State).

## Why

- A dev Daemon in the real `~/.polaris` would write bench sessions into the user's real event log, and a later real Daemon would recover them.
- The scripted bench Harness spends no tokens, so the proof screen's "Start proof session" can run on every launch; it is offered only when the local Daemon runs it (`HostView.proofHarness`).
- Owning the child keeps the machine clean: no orphaned Daemon after the app exits.

## Considered Options

- **Always start a dev Daemon in `~/.polaris`.** Rejected: pollutes real state, and clashes with the installed user service's lock.
- **Never start one; require `bun run --cwd apps/daemon dev`.** Workable, but every dev launch then needs a second terminal, and the real Harnesses would run.

## Consequences

- Smoke tests and benchmarks point the app at any socket with `POLARIS_DESKTOP_LOCAL_SOCKET` (plus `POLARIS_DESKTOP_BENCH_HARNESS=1` when it runs the bench Harness).
- The dev Daemon's state survives app restarts (same temp home) until the OS clears `$TMPDIR`.
