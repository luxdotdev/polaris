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
for anything, or Trust. A submodule's own config runs the same way (`status` and `diff` run
git inside it), as do the ssh command and credential helpers a repository names, and a
remote's `uploadpack` once `url.<path>.insteadOf` makes it local.

Every call also read git's whole stdout into one buffer, so a repository-sized diff or blob
was held (then indexed, decoded and offered as a Blob) whatever its size.

## Decision

`runGitRaw` (`apps/daemon/src/git/git.ts`) is the one place git runs, and by default
(`config: "safe"`) it adds, through `GIT_CONFIG_COUNT` so child gits inherit them:

- settings that run commands, off whatever any config says: `core.hooksPath=/dev/null`,
  `core.fsmonitor=false`, `log.showSignature=false`, `protocol.ext.allow=never`,
  `core.pager=cat`, `core.editor` and `sequence.editor` `false`, an empty `core.askPass`,
  `core.alternateRefsCommand=true`, every `gpg.*` program `false`, `gc.auto=0` and
  `maintenance.auto=false`;
- never into a submodule: `submodule.recurse=false`, `fetch.recurseSubmodules=false`,
  `diff.ignoreSubmodules=dirty`, `diff.submodule=short`, `status.submoduleSummary=false`,
  and `--ignore-submodules=dirty` on `status`, `diff`, `diff-files` and `diff-index`. With
  `dirty` git reads a submodule's HEAD to show a moved pointer, but runs no git inside it, so
  none of the filters, fsmonitor or hooks its own config names. `add -A` takes no such flag
  and runs `status` inside every populated submodule, so a snapshot excludes the index's
  gitlinks (`snapshot.ts`) and keeps their recorded commits;
- an empty command for every `filter.*.clean|smudge|process` and `merge.*.driver` the
  repository's own (local or worktree) config sets, except git-lfs's standard commands.
  Drivers from the user's global or system config still run (git-lfs installed globally);
- the repository's `core.sshCommand` replaced by the Host's (or `ssh`), and when it sets any
  `credential.*helper`, an empty helper (which resets git's list) followed by the Host's own
  helpers again, in order;
- when the repository sets `core.gitProxy` (a command git runs for `git://`), an empty
  `GIT_PROXY_COMMAND`: git takes the first `core.gitProxy` that matches, so a command-line value
  can't beat the repository's, and only the variable can (no proxy; the Host's own `gitProxy`
  is then not used for that repository's automatic git);
- `--no-ext-diff --no-textconv` after `diff`, `log` and `show`, so the patch matches the
  blobs `git.show` returns, and `--upload-pack=git-upload-pack` on `fetch` and `ls-remote`:
  a `url.<path>.insteadOf` can make any remote local, and then `remote.<name>.uploadpack` would
  run on this Host. Only the flag overrides it (a second config value makes git refuse).

The repository's config is read with `git config --list --show-scope --show-origin`, from the
same cwd, environment and global options as the call, so it is git's own discovery
(`GIT_DIR`/`GIT_COMMON_DIR`, bare repositories, `.git` files, a `.git` that isn't a
repository, includes). An earlier cache keyed on a `.git` walk of our own could miss the
config git read and run a driver added since; listing on every call instead doubled the git
bench's latencies (`bun run bench git --quick --runs 3`: status 33 → 57 ms, a checkpoint
72 → 137 ms). So the listing is cached (`safeConfig/discovery.ts`) only where git's own answer
is plain, and only while nothing that decided it changed:

- `git rev-parse --git-dir --git-common-dir --show-toplevel` says where git found the
  repository, before and after the listing (they must agree), with the cwd inside that top
  level and no `GIT_DIR`, `GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_CEILING_DIRECTORIES`,
  `GIT_CONFIG_PARAMETERS`, `-C` or `--git-dir`. A bare repository, `core.worktree`, or a
  failure is never cached;
- every repository-scope entry came from the common dir's `config` or the worktree's
  `config.worktree` (git names its origin), and none is an `include*.path`; every other entry
  came from the command line, a file `git var GIT_CONFIG_SYSTEM`/`GIT_CONFIG_GLOBAL` names, a
  file a Host config includes (resolved as git does: `~/`, absolute, or relative to the
  including file; anything else, such as `%(prefix)/`, is never cached), or git's built-in
  config (Apple's `unknown` scope);
- a stamp of each path is taken before the listing is read and compared on every call: the
  `.git`, `HEAD`, `objects`, `refs` and `commondir` of each directory from the cwd up to the
  top level (where git looked before moving on), the top's `.git`, the git dir's `HEAD`,
  `objects`, `refs` and `commondir`, the common `config`, `config.worktree` (read or not), and
  every system and global file whether it exists or not. The included and built-in files are
  stamped once the listing names them. A file's stamp is its owner and the SHA-256 of its bytes
  (past 1 MB, no cache); a directory's is its inode and owner; a missing one is `-`. An earlier
  version stamped size, mtime and ctime: a rewrite of the same size within one timestamp tick
  (coarse on Linux), a Host file created after the listing (`$XDG_CONFIG_HOME/git/config`, an
  include's target) or a file git found through an include kept a stale listing.

Any difference, or anything uncertain, lists again. With the cache the git bench is at
parity with main (status 34 → 36 ms, a checkpoint 75 → 72 ms, 5 runs); the peak RSS of the
Daemon and its gits is ~10% higher. Hashing instead of stat costs ~0.3 ms a call and two
`git var` calls on a miss; the git bench stays at parity (`--quick --runs 3`, against main on
the same machine: status 34.9 → 36.6 ms, a checkpoint 73 → 72 ms, a working-tree diff 111 → 99
ms). Between a check and the call a writer could still add a driver; an agent writing the
repository's config can run commands anyway. Git's built-in config, when absent at listing,
isn't stamped: writing it means writing inside git's own installation.

`uploadpack.packObjectsHook` is not set: git honours it only from protected (system, global,
command-line) config, never a repository's, and setting it would turn it on.

A Review fetch in a Workspace the user trusts on this Host (`config: "trusted-fetch"`) is the
same, except that the repository's own `core.sshCommand`, `core.gitProxy` and credential
helpers stay: `git config core.sshCommand "ssh -i <key>"` is how a repository uses its deploy
key, and `fetch.test.ts` keeps that working. Trust is the Host's Workspace Trust that worktree
setup also requires (`WorkspaceTrust`, on `WorktreeSetupTrust`'s records); untrusted, or in any
doubt, the fetch runs with the Host's ssh command and helpers only, since opening a pull
request in Review must not run what a prepared Workspace's config names. They run only for
`fetchPullRequest`'s `git fetch` of a pull request's head and base from the remote that is that
pull request's repository (ssh or https), when the user opens the pull request in Review (the
Desktop App checks it out), updates its checkout, or the Daemon resumes that fetch after a
restart. Hooks, filters, fsmonitor and a remote's upload-pack stay off there too.

Other settings in git-config(1) that name commands need nothing more here: `pager.<cmd>` and
`core.pager` run only on a terminal (git's stdout is a pipe); `diff.<driver>.command` and
textconv only on the porcelain diffs that get the flags; `remote.<name>.vcs` names a
`git-remote-<vcs>` helper, which `protocol.<name>.allow` governs (`ext` is never); trace2
targets are read only from protected config; `gc.recentObjectsHook` runs only in a gc or
repack, which automatic git never starts (`gc.auto=0`, `maintenance.auto=false`); and the
`*tool*`, `browser`, `trailer`, `imap.tunnel`, `alias` and `submodule.<name>.update` commands
belong to commands the Daemon never runs automatically.

Git the user asked for passes `config: "host"` and runs with the Host's config and hooks as
before: Changes' stage, unstage, discard and commit, sync, Accept's commit and push, a
session's own Worktree creation (with hooks off, as every Polaris-made worktree is), and a
Constellation's push to origin (git-lfs's pre-push).

Every call's stdout is read under a byte limit (256 MB by default) and git is killed past
it with `GitOutputTooLarge`. `git.diff` and the Reviewer's diff stop at 64 MB, and
`git.show` checks the blob's size with `cat-file -s` before reading any of it, also 64 MB;
both say so in words the Desktop App's existing failed states show ("This diff is larger
than 64 MB, too large to show"). Diff and show also have timeouts.
