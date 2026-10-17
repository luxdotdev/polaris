---
status: accepted
fixes: Accept's merge can't make a merge commit in a repository or for a user that requires signed commits (ENG-351)
---

# Accept's merge signs with the Host's own signing settings

## Context

Accepting a Claim merges the claimed head into the Lead's branch (`constellation/merge.ts`,
ENG-271) with automatic git's safe config (ADR 0056). That config sets every `gpg.*` program to
`false`, because a repository's `.git/config` could name any program there. With
`commit.gpgSign` on, a merge that can't fast-forward then failed with git's "failed to write
commit object", and the Accept was refused with a generic E-GIT.

How git picks what signs (checked on git 2.54):

- `commit.gpgSign` says whether to sign, `gpg.format` (`openpgp`, `x509`, `ssh`) which program
  key to read: `gpg.program` or `gpg.openpgp.program` (the last one read wins), `gpg.x509.program`,
  `gpg.ssh.program`. Defaults: `gpg`, `gpgsm`, `ssh-keygen`. `user.signingKey` names the key
  (for ssh a file, `~/` expanded, or a `key::` literal); without one, openpgp signs as the
  committer and ssh runs `gpg.ssh.defaultKeyCommand`.
- Every scope is last-one-wins in the order system, global, local, worktree, command line,
  and command-line `-c` values are read after `GIT_CONFIG_COUNT` ones, so a `-c` beats the safe
  config's `gpg.program=false` and any value the repository sets.
- An entry from a file another config includes keeps the including file's scope, so a
  repository's `include.path` lists as `local`.
- git starts the program itself, with no shell, from the cwd: a bare name is looked up on
  `PATH`, a name with a separator that isn't absolute is resolved against the repository.
  git 2.54 expands `~/` in `gpg.program`; older gits may not.
- On Windows, Git for Windows resolves a bare name with its own `PATH` lookup, the one that
  already starts ssh and git-lfs for automatic git, and `isAbsolute` takes `C:\…` and `C:/…`
  programs. Not yet checked on a Windows Host (ENG-353).

## Decision

The merge signs only with settings from the Host's own config (system, global, and Apple's
built-in `unknown` scope), passed as `-c` options after the safe config
(`git/safeConfig/signing.ts`, `git/signing.ts`):

- Signing is asked for when `commit.gpgSign` is true in any scope (git's own
  `config --type=bool`), the repository's included: asking to sign runs nothing. Then the merge
  passes `--gpg-sign`, so a change to `commit.gpgSign` mid-merge can't make it unsigned. When it
  isn't asked for, or the merge fast-forwards (no commit), nothing changes.
- `gpg.format`, the format's program, `user.signingKey` and, for ssh, `gpg.ssh.defaultKeyCommand`
  are taken from the Host's scopes only, with git's defaults where unset. Hooks, filters and
  drivers stay off as before.
- Refused with `E-MERGE-SIGN` and "Merge … and sign it yourself, then accept with mergedHead …",
  before git runs, when the repository's own config (or a file it includes) sets any of those
  keys to a value other than the one Polaris would use, when the program or key command is a
  relative path (git would run a file in the repository, `~/` included as older gits don't
  expand it), when an ssh key is a relative path, or when `gpg.format` is unknown.
- Refused the same way when git ran the signer and it failed. The merge is aborted
  (`MERGE_HEAD` is left by a failed signing), so the Lead's tree is as it was.

Refusing a repository's own signing key, rather than signing with the Host's, means a repository
configured with its own `user.signingKey` (a work identity, say) can't be merged by Accept. That
is the trade-off: Polaris never signs with a key or program the repository named, and never with
a different key than the user's own `git commit` in that repository would use.

The signer runs as the user, from their own config, as their own signed commits do; gpg may show
pinentry. The Daemon's own `GIT_CONFIG_PARAMETERS` (command scope) is not read for signing. A bare
program name found through a `PATH` with `.` or a relative entry is the Host's own choice.
