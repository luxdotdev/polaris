---
status: accepted
fixes: a Windows Host had no user service, no `bin/current`, and no way to replace a running Daemon
---

# The Windows Daemon runs as a logon task and upgrades by restarting

## Context

On macOS and Linux `polaris install` registers a user service (launchd, systemd `--user`, or
Polaris' own supervisor), points the symlink `~/.polaris/bin/current` at the version, and
`polaris upgrade` hands the running Daemon to the new binary in place (`execve`, `SIGUSR2`).
A Windows Host (0.2.0, `windows-x64`, ADR 0059) has none of these:

- No user service manager. A Windows service needs an administrator to install; so does a
  scheduled task that runs whether the user is signed in or not (`S4U`): registering one from
  a medium-integrity token fails with "Access is denied", measured with and without triggers.
- Symbolic links need a privilege or Developer Mode, and `rename` can't replace a directory
  link: renaming over an existing symlink fails with `EPERM`, measured.
- No `execve` and no `SIGTERM`: `process.kill` on Windows is `TerminateProcess`, so another
  process can't ask the Daemon to shut down gracefully, let alone hand it over.

Measured on Windows 11 (26200) with Bun 1.4.3, from an SSH session (elevated, with the
NETWORK SID) and from a medium-integrity process in the signed-in session:

- A task with `LogonType=InteractiveToken` and `RunLevel=LeastPrivilege`, for the user's own
  SID, registers from either without an administrator and runs in the console session at
  medium integrity, even when registered from the elevated SSH session.
- A console program started by the task opens a visible console window. Under
  `conhost.exe --headless` it gets a console with no window (`GetConsoleWindow()` returns
  null), so the console programs it starts share that hidden console too.
- `conhost --headless` exits 0 whatever its child does, and `RestartOnFailure` only acts on a
  failed result, at intervals of at least a minute: Task Scheduler can't restart the Daemon.
- `schtasks /End` ends only the task's own process, conhost; the processes under it live on.
- A directory junction needs no privilege, `readlink` gives its absolute target, and a path
  through it reaches the version's files.

## Decision

- **A per-user logon task.** `polaris install` writes the definition (`service/windowsTask.ts`)
  to `~/.polaris/polaris-task.xml` (UTF-16, as `schtasks` reads it) and registers it with
  `schtasks /Create /XML` under `dev.lux.polaris.<user>` (any home but the real profile's
  adds a hash of it, since task names are machine-wide; see Consequences, ENG-322). `schtasks` over `Register-ScheduledTask`: the XML
  sets every option in one pure, tested text, and `schtasks.exe` is always there, without
  PowerShell's startup. Its settings: a logon trigger for the user's SID, interactive token,
  least privilege, no time limit, runs and keeps running on battery, no idle conditions, one
  instance at a time (`IgnoreNew`), normal priority (a task's default 7 also lowers I/O priority).
- **The task runs a small supervisor loop.** Its action is `conhost --headless cmd /c` with a
  loop that runs `bin\current\polaris.exe serve --home .`, appends its output to
  `logs\daemon.{out,err}.log`, restarts it a second after it exits, and ends on exit 75
  (another Daemon holds the lock), 76 (it stopped on request) or once `bin\current\polaris.exe`
  is gone. It runs in the Polaris home and names everything relative to it, so no user path
  goes through cmd's parser; `--home .` sets `POLARIS_HOME`, as Task Scheduler sets no
  environment. Killed, the Daemon is back in under a second.
- **`bin\current` is a junction.** `service/current.ts` points it with a new junction renamed
  into place after the old one is moved aside (a junction can't be renamed over): for that
  instant there is no `current`, and the loop retries a second later. Every reader keeps
  using `bin/current/<binary>`; the binary is `polaris.exe` there (`installedPaths` in the Client).
- **A control pipe stops the Daemon.** Beside its own pipe the Daemon serves
  `<its pipe>-control` (`service/windowsControl.ts`), with the same user-only, local-only
  security (ADR 0059). One JSON line each way: `status` answers its PID and version; `stop`
  answers, then ends the Daemon's scope as `SIGTERM` does elsewhere (finalizers run under the
  same shutdown grace), and it exits 76. The asking side checks the pipe's owner on the handle
  it then writes to. Only `polaris install`, `upgrade` and `uninstall` use it; no Client does.
- **An upgrade stops the Daemon and starts the new one.** `polaris upgrade` on Windows stages
  the binary, repoints `current` and runs `install`: when the running Daemon is another version
  (or the task definition changed) it is asked to stop (`upgrade` or `restart`) and waited
  for, then `schtasks /Run` starts the task, retried until the new version answers on the
  control pipe (a loop still ending makes Task Scheduler ignore one run). Measured: the pipe
  is back 0.4 s after the stop, the whole upgrade takes 1.2 s.
- **Agent Sessions recover as after a restart; terminals end.** The stopping Daemon closes as
  on `SIGTERM`, and the new one applies the restart recovery rule (`daemon.recover`, cause
  `restart`; ADR 0004). Nothing about how commands are decided, committed or recovered
  changes, so the spec doesn't either. Running terminals end with the old process.
- **The new Daemon says why the old one stopped.** The stopping Daemon writes
  `~/.polaris/daemon-stop.json` (reason and version, not for `uninstall`); the next one takes
  it once and announces it as `HostInfo.previousStop` (`reason` is any string on the wire,
  `upgrade` or `restart` today). A Client that sees it after reconnecting can say its
  terminals ended for an upgrade. Older Clients ignore the field; a crash leaves none.
- **Uninstall** asks the Daemon to stop (`uninstall`, so the loop ends), deletes the task, and
  removes `bin`. A running executable can be renamed but not deleted, so `polaris uninstall`
  run from `bin\current` first moves its own binary into the temp directory, where the next
  uninstall deletes it.

## Consequences

- The Daemon runs only while the user is signed in to Windows. Over SSH alone, with nobody
  signed in, `install` fails with "did not start … The task runs only while you are signed in
  to Windows". Running without a sign-in needs an administrator (a service or an `S4U` task).
- A crashed loop (its cmd killed) leaves no Daemon until the next sign-in, an install, or
  `polaris bridge`, which runs the task (`schtasks /Run`) when no Daemon answers.
- An upgrade ends every running terminal and stops in-process Harnesses; the in-place upgrade
  that keeps them is ENG-295. `polaris install` and `upgrade` have no rollback on Windows yet.
- **The task name follows the real profile, and a task is replaced only by its own home**
  (ENG-322). Task names are machine-wide, and the plain name first went to whichever home
  equalled `homedir()\.polaris`; `homedir()` reads `USERPROFILE`, so a test, a dev Daemon or
  the Desktop App's dev mode with a redirected profile computed the real install's name, and
  `schtasks /Create /F` re-pointed the real task at its own home. Now:
  - The plain name `dev.lux.polaris.<user>` belongs to `<real profile>\.polaris`, the profile
    from the process token (`GetUserProfileDirectoryW`, `service/windowsProfile.ts`), which
    ignores `USERPROFILE` and `HOME` (measured on Windows 11 with `USERPROFILE` redirected).
    Every other home, and every home when the lookup fails, gets `.<8 hex of its path>`.
  - The task's working directory is its home, so `install` reads it back
    (`schtasks /Query /XML`, which prints UTF-8, measured with a non-ASCII path) and decides
    with `claimTask`: a task running this home is ours and is replaced; one whose home has no
    `bin\current\polaris.exe` left is abandoned (its loop would exit at once) and is replaced
    with a note; one running another installed home, or that isn't Polaris', is refused:
    `TaskConflictError`, exit 3, `{"ok":false,"error":"TaskConflictError","task",…,"otherHome",…}`
    with `--json`. `--replace-task` takes it over, stopping that home's Daemon first (one
    instance at a time, so its loop would block ours).
  - `uninstall` deletes the task only when it runs its home, and otherwise reports `keptTask`.
  - Migration: a 0.2.0-dev install in the real profile already has the plain name, and its
    task runs that home, so the next install finds it ours and replaces it as before; old
    hashed names don't change either. A real task an earlier redirected home took over is a
    conflict for the real install until `--replace-task` (or until that home is uninstalled).
    A Host still upgraded by a pre-ENG-322 binary runs its old install code once, which has
    the old naming.
- Evidence: `apps/daemon/scripts/e2e-windows-service.ts` drives install, kill, upgrade and
  uninstall on a real Host with a real Client connected throughout. The logon trigger itself
  needs a sign-out and sign-in, done by hand.
