---
status: accepted
fixes: on Windows the Daemon couldn't open a terminal, left a closed terminal's children running, ran shell commands through `/bin/sh`, and couldn't start the shared Codex app-server
---

# Windows ends process trees with taskkill and runs Codex on loopback

## Context

The Daemon's process handling assumed POSIX: children in their own process group, ended
with `kill(-pid)`; shell command lines through `/bin/sh -c`; a terminal hung up with
SIGHUP; the shared Codex app-server on a Unix socket. Measured on Windows 11 with Bun 1.4.3:

- `Bun.spawn` with a `terminal` (ConPTY) refuses any stdio entry past the third: "ipc and
  extra stdio are not supported with terminal on Windows". Resize works through
  `terminal.resize`; `process.kill(pid, "SIGHUP")` throws ENOSYS.
- Closing the ConPTY ends the shell but not what it started: a `ping` run from PowerShell
  kept running after `terminal.close()`.
- Windows has no process groups. `taskkill /T /F /PID <pid>` walks the parent links and
  ends the tree in about 200 ms, as long as the root is still alive: once the shell has
  exited, its children are orphans taskkill can't find from it.
- Windows keeps PATH as `Path`; `process.env` reads it in any case, but a copy
  (`{ ...process.env }`) has only `Path`, so `env.PATH` there was undefined.
- A Harness installed with npm is a `.cmd` shim (`codex.cmd` → cmd.exe → node → codex.exe).
  `Bun.spawn` runs a `.cmd` directly, but killing its pid ends only cmd.exe.
- `codex app-server --listen unix://…` exits with "socket directory is not private to the
  current user" in any directory, even one whose ACL grants only the user; and Bun's
  WebSocket can't reach a Unix socket by a Windows path (`ws+unix://C:\…` is an invalid URL).
  `--listen ws://127.0.0.1:<port> --ws-auth capability-token --ws-token-file <file>` works:
  a client without `Authorization: Bearer <token>` gets no upgrade.

## Decision

- **One module, `apps/daemon/src/platform/processes.ts`**, for what differs: `killTree`
  (POSIX: the signal to the group; Windows: `taskkill /T /F` by its full path under
  `SystemRoot`), `stopChild` (a tree on Windows), `ownProcessGroup()` (`detached` only on
  POSIX: on Windows it means a new console instead), `shellCommand` (`/bin/sh -c`, or
  `cmd.exe /d /s /c "…"` passed verbatim, as npm runs scripts), and `normalizeWindowsEnv`,
  which `main.ts` calls first so every copy of the environment has `PATH`.
- **taskkill, not a Job Object.** A Job Object would also catch orphans, but needs
  `CreateJobObject`/`AssignProcessToJobObject` through `bun:ffi` and a handle kept per child,
  and a child spawned before it's assigned escapes anyway. Every tree we end has a live root
  (we kill before closing the console), so taskkill covers it with no native code.
- **Terminals** pass three stdio entries on Windows, skip the PTY fd scan (there is no fd to
  hand across an upgrade, and upgrades are off there), open PowerShell 7, else Windows
  PowerShell, else cmd (`terminal/shell.ts`), and on close run taskkill on the shell before
  closing the console.
- **The shared Codex app-server on Windows listens on `ws://127.0.0.1:<free port>`** with a
  capability token: 32 random bytes in `~/.polaris/codex-app-server.token`, fresh for every
  server. The URL is recorded as `listen` in `codex-app-server.json`; a Daemon connects to
  what that file names (`connectAppServer`). It starts detached with its output appended to
  the log, and is stopped with taskkill (its pid may be a shim's cmd.exe). The co-attached
  TUI runs through `powershell -EncodedCommand`, which reads the token into
  `POLARIS_CODEX_TOKEN` for `--remote-auth-token-env`, so the token is never in an argv.
  macOS and Linux keep the Unix socket.
- **git on Windows** gets `core.hooksPath=NUL`: Git for Windows warns on every call given
  `/dev/null` there.

## Consequences

- git aborted on Windows is killed outright: it can't remove its lock files as SIGTERM lets
  it, so an abort can leave an `index.lock`.
- A child that daemonizes away from its parent before we kill it escapes taskkill.
- Any local process that can read the token file can use the Codex server; that is the same
  set that could read Codex's own credentials under the user's profile.
- Under Task Scheduler (S3) a task's processes may share a job that ending the task kills;
  whether the Codex server then outlives the Daemon there is untested.
