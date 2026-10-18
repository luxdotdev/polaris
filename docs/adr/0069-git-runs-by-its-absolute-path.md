---
status: accepted
fixes: on Windows the Daemon ran a `git.exe` committed to a repository's root instead of the Host's git (ENG-353)
---

# The Daemon runs git by its absolute path

## Context

Every git the Daemon starts was `Bun.spawn(["git", …], { cwd })`, `cwd` being a Workspace, a
worktree or a Review checkout. Measured on Windows 11 with Bun 1.4.3 (ENG-353, lucas-desktop):

- `Bun.spawn` with a bare name looks in `cwd` before `PATH`, like `CreateProcess`. A `git.exe`
  in the repository's root ran in place of the Host's git, which was on `PATH`; so did a
  `gpg.exe` there. A repository that commits a `git.exe` ran it on the first `git status`.
- `Bun.which("git", { PATH })` never looks in the cwd and skips empty `PATH` entries; a `.`
  entry gives a relative `.\git.exe`.
- A spread of `process.env` keeps Windows' own casing, `Path`, so `env.PATH` was undefined
  there and `safeConfig/lazyFetch.ts`'s own `Bun.which` always fell back to the bare name.
- git itself is not affected: Git for Windows (2.39 and 2.56, the full and MinGit builds,
  through `cmd\git.exe` or directly) looks a bare signing program (`gpg`, `gpgsm`,
  `ssh-keygen`, a custom `gpg.program`, `gpg.ssh.defaultKeyCommand`'s command) up on `PATH`
  only. A `.exe`, `.com`, `.bat` or `.cmd` planted in the repository root never ran, also with
  no signer on `PATH` at all; given by absolute path, the same files did run.

## Decision

- **git runs by its absolute path** (`git/executable.ts`): `gitExecutable(env)` finds git on the
  child's own `PATH` (any casing on Windows) with `Bun.which`, resolves a relative result
  against the Daemon's cwd, never the repository's, and caches it per `PATH`. No git on `PATH`
  fails with "git is not installed, or not on the Daemon's PATH" instead of a bare spawn.
- **Every git spawn passes it**: `git.ts`, `safeConfig/index.ts`, `safeConfig/lazyFetch.ts`,
  `commitMessage/staged.ts`, `files/search/fallback.ts`, `rules/materialize.ts`, `git/write.ts`.
  `security/git-spawn` reports a bare `"git"` argv in those allowlisted files, and treats
  `gitExecutable()` as git everywhere else.
- **Signing programs stay bare names** handed to git (ADR 0068): git's own lookup is the safe
  one, so resolving them ourselves would change nothing a repository controls.

Every other program the Daemon starts follows the same rule: ADR 0070 (ENG-355).
