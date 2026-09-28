# git/

`git.status`, `git.diff`, and the `Checkpoints` and `WorktreeTracker` services (ENG-176, ENG-180).

## Design

- **The Host's own `git` CLI** (`git.ts`), so the user's config, credentials and hooks apply. There is no JS git. Every call sets `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (a background status never takes `index.lock`) and `LC_ALL=C`.
- **`git.status`** (`status.ts`): `status --porcelain=v2 --branch -z --untracked-files=normal`, returning branch, HEAD, ahead/behind, and X/Y codes per entry (`?` untracked, `!` ignored).
- **Checkpoints** (`snapshot.ts`, `Checkpoints.ts`): the design follows pingdotgg/t3code@de251fc (MIT); no code was copied. The user's index is copied into a temp dir, then `GIT_INDEX_FILE=<temp>` runs `git add -A` and `write-tree`, then `commit-tree -p HEAD` (as "Polaris"), then `update-ref refs/polaris/checkpoints/<session>/<turn>/<before|after>`. The copy is only there so the stat cache keeps it fast. The user's index, HEAD and branch are never written. Untracked-but-not-ignored files are included. Outside a repo, `capture` returns null.
- **`git.diff`** (`diff.ts`), sent back through the `BlobChannel`, with `files` counting `diff --git` headers:
  - `WorkingTree`: a snapshot tree compared with `base` (or HEAD, or the empty tree on an unborn branch). Untracked files are included.
  - `Turn`: the `before` checkpoint compared with `after`. If `after` doesn't exist yet (the Turn is still Working), it compares with the current working tree. A missing `before` is `NotFound`.
  - `Range`: `base` compared with `head`.
- **WorktreeTracker** (`WorktreeTracker.ts`): git's registry (`worktree list --porcelain -z`) is the source of truth, so worktrees can live anywhere. `watch` emits the list at once, then again on change. It watches the common dir (non-recursive) and `worktrees/` (recursive, re-armed when it appears or vanishes), debounced by 150 ms, with a 30 s poll as a safety net.
  - `create` runs `worktree add -b <branch> <path> [baseRef]`. It checks out the branch instead if it already exists.
  - `remove` runs `worktree remove` without `--force`, so a dirty worktree is refused. The branch is deleted only when `deleteBranchIfMerged` is set and the branch is an ancestor of the main worktree's HEAD, and then with `branch -d` (never `-D`).
- **Handlers**: `GitRpcsLive` is a partial `DaemonRpcs` handler layer, which needs `BlobChannel` for each request.

## Known gaps / TODOs

- Checkpoints run `git add -A`, which runs clean filters (e.g. LFS). That respects the user's config, but it can be slow.
- Checkpoint refs are never garbage-collected. Pruning them with their Agent Session belongs to the engine.
- `git.status` uses `--untracked-files=normal`, so untracked directories are collapsed.
