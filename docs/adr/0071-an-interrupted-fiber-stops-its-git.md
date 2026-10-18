---
status: accepted
fixes: an interrupted git call kept running in the repository after its fiber ended (ENG-358)
---

# An interrupted fiber stops its git, and waits for it

## Context

Every Effect that ran git wrapped a promise in `Effect.tryPromise` or `Effect.promise` and
ignored the AbortSignal Effect hands it. Effect 4's `tryPromise` aborts that signal on
interrupt and completes at once, without waiting for the promise. So on shutdown, a canceled
Reviewer run or a closed Workspace, git kept running: on a Windows VM a `git update-ref
--stdin` was still alive in the user's clone after its test had finished, and held the
directory (ENG-356). Plumbing a signal through every async helper between the Effect and
`runGitRaw` (checkpoints, Accept, the Review checkout, Constellation transfers) would touch
dozens of signatures.

Not every git may be killed mid-way. A ref transaction killed by SIGTERM removes its lock
files and writes nothing, but `taskkill /F`, the only kill Windows has, leaves them. A merge
killed while it signs has already written the merged index and work tree, with no
`MERGE_HEAD` for `merge --abort` to find. An Accept killed between its commits and its index
sync leaves staged reversals.

## Decision

- **The signal is ambient** (`git/interrupt.ts`): `interruptibleGit` and `finishingGit` run
  their promise under an `AsyncLocalStorage` holding the signal, and every git spawn under it
  reads the signal (`runGitRaw`, `safeConfig`'s config listing, `rules/materialize.ts`,
  `commitMessage/staged.ts`). An explicit `GitOptions.signal` (sync) is joined with it.
- **An abort ends git's tree**: SIGTERM to its process group, SIGKILL after 2 s; `taskkill /T
  /F` on Windows. A git asked to start once the signal has aborted never starts
  (`GitInterrupted`).
- **The Effect completes after git exits**, waiting at most 5 s past the kill, so the
  directory is free once the fiber ends and a lost exit can't hang shutdown (15 s grace).
- **Reads are killed at once** (`interruptibleGit`): status, diffs, show, the Reviewer's
  reads, the Rules' cat-file, worktree listings.
- **Writes get 5 s to finish first** (`finishingGit`), then are killed: checkpoints, prune,
  Accept's commits, branches, pushes and reverts, stage/unstage/discard, the Review checkout's
  fetches, pins and moves, worktree add/remove, Constellation transfers and Accept's merge.
- **Cleanup runs regardless** (`uninterrupted`): a killed merge is undone (`merge --abort`, or
  `reset --merge` to the head it started from when it had not committed); a killed Accept
  still restores its branch and syncs the index. Shared cache fills (`git var`, the Reviewer's
  instructions name) run outside any caller's signal too.
- **Left alone**: `git commit` from `git.commit` runs in its own promise and is never killed
  (the user's hooks run); `git --version` is cached per PATH and tiny; `git grep` in file
  search shares its index across callers and stops at its result limit (ENG-364).

## Consequences

On Windows a write killed past its deadline can leave a lock file, since `taskkill /F` skips
git's cleanup (ENG-363). `taskkill /T` also misses an MSYS grandchild (a signer's `sleep`),
which keeps git's pipes open; a killed git's pipes are read for only 1 s after it exits, but
the grandchild runs on (ENG-367). An interrupted Rules run now waits for its scanners to settle too,
for up to 5 s.
