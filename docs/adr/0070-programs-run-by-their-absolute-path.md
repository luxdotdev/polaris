---
status: accepted
fixes: on Windows a Terminal, a worktree setup or a Harness lookup could run a program committed to a repository instead of the Host's (ENG-355)
---

# Every program the Daemon starts runs by its absolute path

## Context

ADR 0069 made git start by its absolute path. Measured again on Windows 11 with Bun 1.4.3
(ENG-355, lucas-desktop), for any program:

- `Bun.spawn([name], { cwd })` runs `cwd\name.exe`, `.bat` or `.cmd` before anything on `PATH`.
  It does so with only `;` or `.` as `PATH`, and `NoDefaultCurrentDirectoryInExePath` in the
  child's env does not stop it for an `.exe`.
- cmd.exe (`cmd /d /s /c "bun install"`, what worktree setup runs, and what an npm `.cmd` shim
  runs its `node` with) looks in its cwd first too, but not when `NoDefaultCurrentDirectoryInExePath`
  is set. PowerShell never runs a program from its cwd without `.\`.
- `Bun.which` never looks in the cwd and skips empty `PATH` entries, but returns a relative
  `.\name.exe` for a `.` entry, which a spawn then resolves against its own cwd. It tries
  `.com`, `.exe`, `.bat` and `.cmd` whatever `PATHEXT` says.
- On macOS and Linux (Bun 1.4.3) an empty `PATH` entry is skipped, but a `.` entry in the child's
  `PATH` finds `cwd/name`: a repository's program there too, if the user's `PATH` has `.`.
- A spread of `process.env` keeps Windows' `Path`; `repositoryEnv` and `setupEnv` kept only
  `PATH`, so a Review Run's, the Rules' or a setup's child got no `PATH` at all.

## Decision

- **One resolver**, `platform/executable.ts`: `findExecutable(program, env)` returns an absolute
  path as given, a relative path against the Daemon's cwd, and a bare name from the child's own
  `PATH` (any casing), never the child's cwd; on Windows it walks `PATH` itself in `PATHEXT`'s
  order over the extensions Bun.spawn can start. `executableOf` caches it per program, `PATH`
  and `PATHEXT`, and throws `ExecutableNotFound` instead of falling back to the bare name.
- **Every spawn passes it**: Terminals (`programIn`: a bare name off `PATH`, a relative path in
  the Terminal's cwd as a shell would), language servers, formatters and probes, the Harness
  lookups (`POLARIS_<HARNESS>` overrides, `harnessBinary`, the npm-shim target's `node`), the Rules'
  Betterleaks and `tar`, `ssh -G`, `ps`, `stty`, `CommandRunner` and `schtasks` (System32).
- **cmd.exe children of a repository get `NoDefaultCurrentDirectoryInExePath=1`**
  (`repositoryEnv`, `setupEnv`): a setup's `bun install` or `npm ci` finds the Host's `bun`, and a
  Review Checkout's cmd terminal won't run the pull request's `.exe` by a bare name. A custom
  setup command that relied on cmd's cwd lookup now writes `.\name`. A user's own terminal and the
  Harnesses' shells keep cmd's behaviour.
- **`security/spawn-path`** reports a bare-name program anywhere in the Daemon, a spawn with a
  `cwd` whose program it can't see resolved, and `Bun.which` outside the resolver.
