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
- Bun spawns through libuv, which puts each child in a job with `KILL_ON_JOB_CLOSE` and
  `SILENT_BREAKAWAY_OK`: the child dies with the Daemon, but what the child starts is in no
  job at all. That is why a killed Daemon's shim cmd.exe ended and its codex.exe didn't.
  A process created suspended (`CreateProcessW` with `CREATE_SUSPENDED`), assigned to a job
  of our own that allows no breakaway and then resumed, has every descendant in that job,
  libuv's nested jobs included (measured on Windows 11 with codex 0.163.0's npm shim).
- An elevated process creates files owned by Administrators unless the security descriptor
  it passes names an owner; the user's own SID is always allowed as that owner.
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
  (we kill before closing the console), so taskkill covers it with no native code. The
  Codex app-server is the exception (below): it must not outlive a Daemon killed outright.
- **Terminals** pass three stdio entries on Windows, skip the PTY fd scan (there is no fd to
  hand across an upgrade, and upgrades are off there), open PowerShell 7, else Windows
  PowerShell, else cmd (`terminal/shell.ts`), and on close run taskkill on the shell before
  closing the console.
- **The shared Codex app-server on Windows listens on `ws://127.0.0.1:0`**
  (`harness/codex/windowsServer.ts`), with a capability token: 32 random bytes, fresh for
  every server, in `~/.polaris/codex-app-server/token` (`windowsToken.ts`). The directory
  and the token are created with an explicit security descriptor, `O:<user>D:P(A;OICI;FA;;;<user>)`
  (`CreateDirectoryW`/`CreateFileW` through `bun:ffi`, `platform/windowsNative.ts`; the SID
  from the process token), so they are the user's from the moment they exist, elevated or
  not, and a `POLARIS_HOME` under `C:\` passes nothing down. The token is written to a
  random name (`CREATE_NEW`) and renamed into place. An existing directory is kept only when
  its owner is the user, Administrators or SYSTEM (an owner only an administrator can set,
  and an administrator can read the token anyway), and then its DACL is reset to the user's
  alone. Any other owner keeps `WRITE_DAC` and could swap the token: such a directory is
  removed and recreated when it holds only token files, else the launch is refused.
- **The state file is private too.** `codex-app-server.json` decides where the token goes
  (`listen`, `listenerPid`, `listenerCreated`), so on Windows it is written the same way as
  the token, and read only when its owner is one the directory would be kept for: a file
  someone else put in its place is ignored.
- **The server runs in a Job Object of its own.** It is started with `CreateProcessW`
  (`spawnInJob`): suspended, windowless (`CREATE_NO_WINDOW`, `SW_HIDE`), inheriting only
  `NUL` and the log (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`), assigned to a new job with
  `KILL_ON_JOB_CLOSE` and no breakaway, then resumed. A `.cmd` shim runs as `cmd.exe /d /s
  /v:off /c "…"` with every argument quoted; an argument with `%` or `"` is refused rather
  than expanded. Only the Daemon holds the job's handle, so the Daemon exiting in any way,
  killed outright included, ends the shim, node, codex.exe and whatever codex started. The
  Daemon also holds the root's process handle, so its pid can't be reused while it runs.
- **The port is the listener inside the job.** The launch polls the TCP listener table
  (`GetExtendedTcpTable`, `TCP_TABLE_OWNER_PID_LISTENER`) and the job's process list: the
  server's port is the 127.0.0.1 listener whose pid is in the job, and more than one fails
  the launch. That pid and its creation time (`GetProcessTimes`) are recorded as
  `listenerPid`/`listenerCreated`, with the URL as `listen`. Before every connection
  `connectAppServer` checks that the port has one listener, that it is `listenerPid`, and
  that `listenerPid` still has the recorded creation time: a process that took the pid, the
  port or both is sent no token, prompt or code. The check is two in-process calls (about
  0.3 ms); nothing is spawned.
- **The server lives as long as the Daemon** on Windows, never `detached` (see Context). The
  Daemon's scope ends it by terminating its job. A Daemon that starts and finds a recorded
  server it didn't start (one from before the job, or a home shared another way) ends it
  only while it is still that server: the root, and the listener, each only when its command
  line names `app-server` and this home's token file, and the listener only while it is the
  recorded process. Codex keeps threads on disk, so after an upgrade they are resumed on the
  new server. The co-attached TUI runs through
  `powershell -EncodedCommand`, which reads the token into `POLARIS_CODEX_TOKEN` for
  `--remote-auth-token-env`, so the token is never in an argv. macOS and Linux keep the Unix
  socket.
- **A job for this server only, not for the Daemon.** Assigning the Daemon itself to a
  kill-on-close job would also tie every terminal command and Harness to its lifetime and
  change how all of them end; that is a separate decision. The process-tree walk S2 used
  (CIM `Win32_Process` parent links checked by creation time) is gone: membership in the
  job is exact, and needs no PowerShell.
- **git's hooks path on Windows is the running executable** (`process.execPath`): absolute,
  always present, and a file, so `<it>\pre-commit` can't exist. POSIX keeps `/dev/null`.

## Consequences

- git aborted on Windows is killed outright: it can't remove its lock files as SIGTERM lets
  it, so an abort can leave an `index.lock`.
- A child that daemonizes away from its parent before we kill it escapes taskkill.
- Any process running as the user can read the token file and use the Codex server; that is
  the same set that could read Codex's own credentials under the user's profile.
- The Codex server is started through native code (`bun:ffi`): kernel32, advapi32 and
  iphlpapi calls whose struct layouts are written out for x64 (`windowsNative.ts`). An
  arm64 Windows build would need them checked.
- If the job can't be made or assigned (a parent job that forbids nesting), the launch
  fails instead of starting a server that could outlive the Daemon.
- Codex's own children die with the server. A command it was running when the Daemon
  exited does not survive the Daemon.
- The listener check still has a gap between the check and the WebSocket connect: a server
  that dies in it hands its port to whoever binds next. The job makes that death rare.
- A recorded server from a Daemon before ENG-317 (no job) is still found and ended by the
  next Daemon, as before; its `listenerCreated` was rounded to microseconds by CIM, so only
  its root is recognized.
