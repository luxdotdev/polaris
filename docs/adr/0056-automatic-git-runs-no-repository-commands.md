---
status: accepted
fixes: opening a Workspace or a Review could run commands its own git config or hooks named, and a huge diff or blob could exhaust the Daemon
---

# Automatic git runs no repository commands, and its output is bounded

## Context

The Daemon runs the Host's `git` for its own work: the explorer's status, Changes and
Turn diffs, checkpoints and snapshots, Review refs and checkouts, context expansion. A
Workspace's `.git/config` and `.git/hooks` are part of what arrived with it (a prepared
folder, an archive, an in-place Agent Session's writes), and git runs commands they name
on ordinary operations: `core.fsmonitor` on `status`, a filter's `clean` when it hashes a
changed file, `diff.external` and textconv on `diff`, a `reference-transaction` hook on
`update-ref`, through a relative `core.hooksPath` too. None of those needed the user to ask
for anything, or Trust.

Every call also read git's whole stdout into one buffer, so a repository-sized diff or blob
was held (then indexed, decoded and offered as a Blob) whatever its size.

## Decision

`runGitRaw` (`apps/daemon/src/git/git.ts`) is the one place git runs, and by default
(`config: "safe"`) it adds, through `GIT_CONFIG_COUNT` so child gits inherit them:

- `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `log.showSignature=false`,
  `protocol.ext.allow=never`;
- an empty command for every `filter.*.clean|smudge|process` and `merge.*.driver` the
  repository's own (local or worktree) config sets, except git-lfs's standard commands.
  Drivers from the user's global or system config still run (git-lfs installed globally).
  The local config is read with `git config --list --show-scope` and cached per `.git`,
  keyed on the stat of the config files; a config that includes other files is read on
  every call;
- `--no-ext-diff --no-textconv` after `diff`, `log` and `show`, so the patch matches the
  blobs `git.show` returns.

Git the user asked for passes `config: "host"` and runs with the Host's config and hooks as
before: Changes' stage, unstage, discard and commit, sync, Accept's commit and push, a
session's own Worktree creation (with hooks off, as every Polaris-made worktree is), and a Constellation's push to origin
(git-lfs's pre-push). Network settings (`core.sshCommand`, credential helpers) are not
touched: automatic fetches use the user's own transport.

Every call's stdout is read under a byte limit (256 MB by default) and git is killed past
it with `GitOutputTooLarge`. `git.diff` and the Reviewer's diff stop at 64 MB, and
`git.show` checks the blob's size with `cat-file -s` before reading any of it, also 64 MB;
both say so in words the Desktop App's existing failed states show ("This diff is larger
than 64 MB, too large to show"). Diff and show also have timeouts.
