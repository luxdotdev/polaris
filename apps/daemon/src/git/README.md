# git/

`git.status`, `git.diff`, and the `Checkpoints` and `WorktreeTracker` services (ENG-176, ENG-180).

## Design

- **The Host's own `git` CLI** (`git.ts`), so the user's config, credentials and hooks apply. There is no JS git. Every call sets `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (a background status never takes `index.lock`) and `LC_ALL=C`.
- **`git.status`** (`status.ts`): `status --porcelain=v2 --branch -z --untracked-files=normal`, returning branch, HEAD, ahead/behind, and X/Y codes per entry (`?` untracked, `!` ignored).
- **Checkpoints** (`snapshot.ts`, `Checkpoints.ts`): the design follows pingdotgg/t3code@de251fc (MIT); no code was copied. `GIT_INDEX_FILE=<own index>` runs `git add -A` and `write-tree`, then `commit-tree -p HEAD` (as "Polaris"), then `update-ref refs/polaris/checkpoints/<session>/<turn>/<before|after>`. The user's index, HEAD and branch are never written. Untracked-but-not-ignored files are included. Outside a repo, `capture` returns null.
  - **Own index**: `<git dir>/polaris/index`, one per worktree, kept between snapshots so git's stat cache stays warm: `add -A` rehashes only what changed since the last snapshot, however stale the user's index is. It is seeded by copying the user's index (keeping its mtime, so git's racily-clean check still catches a same-size edit made in the same instant; `snapshot.test.ts`), and reseeded whenever the user's index changes (a stat signature), so which files count as tracked (kept even if ignored) follows the user's index. Written with `index.skipHash` (no SHA over the whole index per write). Snapshots of one worktree are serialized; if anything fails with the own index (corrupt, locked, a pruned object), it is deleted and that snapshot falls back to a throwaway copy of the user's index.
  - Repository paths (top level, both index paths) are looked up once per cwd with a single `rev-parse`, and HEAD is resolved alongside `add -A`. Outside a repository no git is spawned at all: `mayBeInWorkTree` (`git.ts`) walks up from the cwd looking for `.git` (a directory, or the file of a worktree or submodule) first, as `findRepoRoot` does too; with `GIT_DIR` or `GIT_WORK_TREE` set it always asks git.
  - **Commit reuse**: when a snapshot has the same tree and HEAD as the previous checkpoint of that repository (within 10 minutes), its commit is reused: a Turn's `before` is usually identical to the previous Turn's `after`. The commit message then names the earlier checkpoint. If the reused commit is gone (pruned and gc'd), a new one is written.
- **`git.diff`** (`diff.ts`), sent back through the `BlobChannel`, with `files` counting `diff --git` headers:
  - `WorkingTree`: a snapshot tree compared with `base` (or HEAD, or the empty tree on an unborn branch). Untracked files are included.
  - `Turn`: the `before` checkpoint compared with `after`. If `after` doesn't exist yet (the Turn is still Working), it compares with the current working tree. A missing `before` is `NotFound`.
  - `Range`: `base` compared with `head`.
- **WorktreeTracker** (`WorktreeTracker.ts`): git's registry (`worktree list --porcelain -z`) is the source of truth, so worktrees can live anywhere. `watch` emits the list at once, then again on change. It watches the common dir (non-recursive) and `worktrees/` (recursive, re-armed when it appears or vanishes), debounced by 150 ms, with a 30 s poll as a safety net.
  - `create` runs `worktree add -b <branch> <path> [baseRef]`. It checks out the branch instead if it already exists.
  - `remove` runs `worktree remove` without `--force`, so a dirty worktree is refused. The branch is deleted only when `deleteBranchIfMerged` is set and the branch is an ancestor of the main worktree's HEAD, and then with `branch -d` (never `-D`).
- **Checkpoint pruning** (`prune.ts`). Each ref pins a full working-tree snapshot, so refs are pruned by this policy (`planCheckpointPrune`, pure and unit-tested):

  | Session | Kept |
  |---|---|
  | not Archived | everything: any Turn can be reviewed or forked |
  | Archived < 7 days (`compactAfterMs`) | everything: Archive can be undone, and a Fork may start from any Turn of an Archived session |
  | Archived 7–30 days | the first Turn's `before` and the last Turn's `after` (the whole session's diff, what a later Review compares), plus both refs of pinned Turns (ones another session forked from) |
  | Archived > 30 days (`dropAfterMs`) | nothing, **unless** its Worktree branch still exists and is not merged into the main worktree's HEAD; then the endpoints stay as long as it is unmerged |
  | unknown to the engine (orphan) | everything, unless `pruneOrphans` |

  Deleting a ref only makes the snapshot unreachable; git's automatic `gc` reclaims it later. Polaris never runs `gc` in a user's repository. Deletions are one `update-ref --stdin` transaction.

  Engine wiring (`engine/Engine.ts`): on `ArchiveSession` the engine calls `onSessionArchived(workspace.path, { sessionId, archivedAt, turnIds, pinnedTurnIds, worktreeBranch })` (with the default policy it deletes nothing yet; it is the hook for a shorter policy). In its scope it forks `runCheckpointSweeper({ targets })`, where `targets` is an Effect evaluated at each sweep that lists each git Workspace path with all its sessions (`archivedAt` null unless Archived, `turnIds` in order, `pinnedTurnIds` = Turns any Fork started from, `worktreeBranch` of the Worktree the session created). It sweeps at start and every 6 hours; a failing repository is logged and skipped. On `RemoveWorkspace` it calls `dropSessionCheckpoints` for each of the Workspace's sessions. Tested end to end with the fake Harness and real repositories in `engine/Engine.checkpoints.test.ts`.
- **Handlers**: `GitRpcsLive` is a partial `DaemonRpcs` handler layer, which needs `BlobChannel` for each request.

## Known gaps / TODOs

- Checkpoints run `git add -A`, which runs clean filters (e.g. LFS). That respects the user's config, but it can be slow.
- On a 50k-file tree a snapshot is still ~150 ms, mostly `add -A` checking every file (`lstat` of each tracked file plus the untracked scan; git's untracked cache doesn't apply to `add`). A user's `core.fsmonitor` applies and cuts that; turning it on for them, or re-adding only paths from a watcher's change set, would too, but a missed event would silently drop a change from a checkpoint.
- `git.status` uses `--untracked-files=normal`, so untracked directories are collapsed.
