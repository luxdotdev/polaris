# A Fork gets its own Worktree at the forked Turn's checkpoint

`ForkSession` of a Turn with an after-checkpoint, in a git Workspace, places the Fork in its own Worktree: `<worktreeRoot>/polaris/fork-<8 hex of the Fork's session id>`, on a new branch of the same name created at `refs/polaris/checkpoints/<parent>/<turn>/after`. The decider records that placement; the reactor creates the Worktree after commit. Without a checkpoint (not a git repository, or the capture failed) the Fork shares the parent's directory.

## Why

A Fork exists to try something else from a point in the conversation. Starting it in the parent's working tree would make both sessions edit the same files, and the Fork would see the parent's later edits rather than the code as it was at the forked Turn. The after-checkpoint is exactly that code, so a branch at it gives the Fork the right starting point and keeps the two apart.

The branch name is derived from the Fork's session id so that the decider (which must know the cwd and Worktree id to record the session) and the reactor (which creates it) agree on it without sharing state.

## Considered Options

- **Always share the parent's directory.** Rejected for the reasons above; it remains the fallback when there is no checkpoint.
- **Let the user pick a branch.** Possible later; a derived name keeps Fork a one-click action.

## Consequences

- A Fork's Harness always starts fresh (it never reuses the parent's cursor) and its first Turn carries a preamble of the parent's conversation up to the fork point (`apps/daemon/src/engine/fork.ts`).
- Archiving the Fork removes its Worktree and keeps the branch, like any session-created Worktree; Unarchive recreates it from the branch.
