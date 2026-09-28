# terminal/

The `Terminals` service and the `terminal.open/attach/input/resize/close` handlers, built on `Bun.Terminal` (never node-pty).

## Design

- `open` runs `Bun.spawn(argv, { terminal: { cols, rows, data } })` in `cwd`, with `TERM=xterm-256color`. With no `argv`, it runs the Host user's login shell (the passwd entry, else `$SHELL`, else `/bin/sh`) with `-l`. A missing `cwd` is a `FileError`.
- **The Daemon owns terminals**: they outlive Client disconnects. Any number of Clients can attach. Each terminal keeps a **256 KiB scrollback** ring (`SCROLLBACK_BYTES`), which is replayed first to every attacher. The replay and the live subscription happen synchronously, so no output is lost or duplicated between them.
- When the process exits, `Exit { code }` is sent (after 200 ms for the PTY to drain) and attach streams end. A signal gives `code: null`. An exited terminal still replays its scrollback and `Exit` until it is closed.
- `close` sends SIGHUP (as closing a terminal window does), closes the PTY, sends `Exit { code: null }`, and forgets the terminal. Closing the layer's scope (Daemon shutdown) closes every terminal.
- **Handlers**: `TerminalRpcsLive` is a partial `DaemonRpcs` handler layer. It needs `Terminals` (`TerminalsLive`).

## Known gaps / TODOs

- Each attacher's queue is unbounded, so a stalled Client buffers output in the Daemon until it detaches.
- Exited terminals stay until `close`. There is no TTL yet.
- Terminals are not tied to a Workspace id. `open` takes only a `cwd`, as the protocol does.
- Terminals don't survive a Daemon restart.
