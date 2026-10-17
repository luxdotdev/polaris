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
  `--listen ws://127.0.0.1:0 --ws-auth capability-token --ws-token-file <file>` works:
  codex binds a free port itself, and a client without `Authorization: Bearer <token>` gets
  no upgrade.
- A `detached` child is worse on Windows in every way we tried. Its stdout and stderr are lost
  (even through cmd's own `>>`). Started from a windowless process (S3's Daemon runs under a
  hidden `conhost --headless`), the shim's node opens a visible Windows Terminal window.
  `Start-Process -WindowStyle Hidden` run from a detached PowerShell never starts its child,
  and `conhost --headless <cmd>` spawned by Bun exits at once without running it. A child
  spawned normally with `windowsHide` opens no window, and its output reaches a log file.
- A pid is reused, and `ParentProcessId` is a number that outlives the parent: a process
  whose parent died can name a newer process with the same pid as its parent.
- Loopback is reachable by every local process and account. A port picked in advance can be
  taken before codex binds it, and the Daemon would then hand that squatter the token.
- Git resolves a relative `core.hooksPath` against the working tree. `NUL` is relative: with
  a `NUL\pre-commit` planted in the checkout (`\\?\` paths allow the name), Git for Windows
  2.39 found it and tried to spawn it. `/dev/null` is read as `%(prefix)/dev/null`, a path
  inside Git's install.

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
- **The shared Codex app-server on Windows listens on `ws://127.0.0.1:0`**
  (`harness/codex/windowsServer.ts`), with a capability token: 32 random bytes, fresh for
  every server, in `~/.polaris/codex-app-server/token` (`windowsToken.ts`). The directory
  is made private first: an ACL of the user's SID alone (`icacls /inheritance:r /grant:r
  *SID:(OI)(CI)F`, the SID from `whoami /user`, so a `POLARIS_HOME` under `C:\` inherits
  nothing). The token is then written to a random name with `wx` and renamed into place, so
  nobody can open it between its creation and its ACL, or plant it beforehand.
- **The port is the listener of the started tree.** The pid Bun spawned and its creation time
  are taken at spawn, while Bun holds a handle to it. The port is the loopback listener
  (`netstat -ano`) whose process walks up to that root (CIM `Win32_Process`). A parent link
  counts only if the parent was created no later than the child, and the root must match the
  recorded creation time (`platform/windowsTree.ts`), so a reused pid breaks the chain. More
  than one such listener fails the launch. That listener's pid and creation time are recorded
  as `listenerPid`/`listenerCreated` with the URL as `listen`, and before every connection
  `connectAppServer` checks that the port's listener is still `listenerPid`: no token,
  prompt or code goes to anything else on that port.
- **A tree walk, not a Job Object**, for the same reasons as taskkill: a job needs `bun:ffi`
  and a handle per child, and the shim's cmd.exe runs node before it could be assigned, so
  the listener could be born outside it. The walk needs nothing native and fails closed.
- **The server lives as long as the Daemon** on Windows. It is a normal child with
  `windowsHide`, its output appended to the log, never `detached` (see Context). The
  Daemon's scope stops it when the Daemon exits, root and listener, and a Daemon that starts
  stops a recorded server whose listener is still the same process before starting its own.
  Codex keeps threads on disk, so after an upgrade they are resumed on the new server. The co-attached TUI runs through
  `powershell -EncodedCommand`, which reads the token into `POLARIS_CODEX_TOKEN` for
  `--remote-auth-token-env`, so the token is never in an argv. macOS and Linux keep the Unix
  socket.
- **git's hooks path on Windows is the running executable** (`process.execPath`): absolute,
  always present, and a file, so `<it>\pre-commit` can't exist. POSIX keeps `/dev/null`.

## Consequences

- git aborted on Windows is killed outright: it can't remove its lock files as SIGTERM lets
  it, so an abort can leave an `index.lock`.
- A child that daemonizes away from its parent before we kill it escapes taskkill.
- Any process running as the user can read the token file and use the Codex server; that is
  the same set that could read Codex's own credentials under the user's profile.
- The listener check costs one `netstat` per connection (tens of ms) and the launch a
  process-table query per poll once a listener appears; both are Windows only.
- A Daemon killed outright leaves codex.exe running (measured: the shim's cmd.exe ends, its
  listener doesn't). The next Daemon on that `POLARIS_HOME` stops it; until one starts it
  keeps its port.
- A process that got both the dead server's pid and its port before the next connection
  would pass the check and be sent the token.
