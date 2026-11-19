---
status: accepted (ENG-980)
---

# A shell command shows the files the tree changed while it ran

## Context

Inline edits (ENG-979) show what the Harness's file tools wrote. Most edits aren't made with
them: across 40 recent Claude Code transcripts, 1,189 Bash calls wrote files against 202 calls
of Edit, MultiEdit, Write and NotebookEdit. 70% of those are `python3 - <<'EOF'` scripts that
read, replace and write; the rest are `sed -i`, heredocs and redirects. A command's row showed
its output and nothing of what it changed. Steering models toward the Edit tool is not an
option: the transcript shows what the agent did, however it did it.

A command's text doesn't say what it writes, so the Daemon has to look at the working tree.
It already snapshots it per Turn (`apps/daemon/src/git/snapshot.ts`): `git add -A` and
`git write-tree` through Polaris's own index, about 150 ms on a 50,000-file tree on an M2 Max.

## Decision

**Two trees per command.** Before a shell command runs and after it ends, the Daemon takes the
working tree's tree through its own index (`snapshotTree`: `add -A`, `write-tree`; no HEAD
lookup). Nothing else is written: no commit and no ref. `git diff-tree -r --raw` of the two
trees names the changed files, and one `git cat-file --batch` reads their blobs for
`filePatch`, the builder inline edits use, with its 64 KB cap per file. The changes go on the
command's own item, as `CommandExecution.changes` (and `moreChanges`), in the shape a
`FileChange` carries. The Desktop App draws them under the command's row with the same
component: "Changed 2 files", then each file's counts and first changed lines.

**What is attributed.** Every difference between the two trees is the command's: a file a
formatter, a watcher or the user wrote while it ran shows on it too. The Daemon can't tell
writers apart, and the row says "Changed", not "wrote". Commands that overlap (parallel tool
calls) each show what changed in their own window. Ignored files are not in a snapshot, so
they never show.

**Read-only commands take no snapshot.** `isReadOnlyCommand`
(`apps/daemon/src/harness/readOnlyCommand.ts`) is an allowlist: `ls`, `cat`, `rg`, `grep`,
`git status`/`log`/`diff`/`show` and their like, joined by `&&`, `||`, `;` or `|`, with no
redirect but `2>&1` and `2>/dev/null`, no substitution, variable, escape or second line, and
none of the flags that write (`find -delete`, `sort -o`, `git diff --output`, `rg --pre`).
Anything it can't follow counts as writing. A command run in the background takes none
either: it outlives its call, and its row is done before it writes.

**Where it hooks in.** Claude Code: Agent SDK `PreToolUse`, `PostToolUse` and
`PostToolUseFailure` hooks on Bash (`harness/claude/commandChanges.ts`). Claude Code waits
for a `PreToolUse` hook, so the first tree is taken before the command starts. The changes
and the command's result reach the Daemon in either order: when the changes are first, the
item completes once, with them; when the result is first, the item completes at once and
completes again when the changes are read. A Turn's patch budget (2 MiB, ENG-979) counts a
command's patches, once per item.

**One snapshot at a time per worktree.** Per-command snapshots run in the queue the per-Turn
checkpoints use (`serialized` in `snapshot.ts`), on the same index, which stays warm.

**A budget, and names past it.** A command waits at most 400 ms for the tree before it
(`COMMAND_SNAPSHOT_BUDGET_MS`). Each snapshot's own time decides how that worktree's next
command is handled:

| A snapshot took | Next command |
|---|---|
| up to 400 ms | a tree before and after it; files with patches |
| over 400 ms | no tree before it, so it isn't held. One tree after it, compared with the Turn's last tree, else with the Turn's `before` checkpoint: file names from the Turn's diff, without patches. The model's next call doesn't wait for it. |
| over 2.5 s | no snapshots of that worktree for 10 minutes, then one command is tried as in the row above |

Names past the budget can include a file an Edit or the user changed since the Turn's last
snapshot; that is why they carry no patch.

**Limits per command.** 200 files listed, the rest counted; patches for the first 20 files
that are regular files, not binary and at most 1 MiB, within 4 MiB read in all.

## Measurements

The `commands` bench scenario (`packages/bench/src/scenarios/commands.ts`) runs a Turn of 40
real shell commands on the 50,000-file tree through the scripted Harness. Medians of 3 runs on
an M2 Max (with 10.8 cores busy with other work):

| | M2 Max, 50k files |
|---|---|
| held before the command (`command_before_ms`) | 127 ms (p95 151) |
| after it: tree, diff, patches (`command_after_ms`) | 158 ms (p95 180) |

On a Raspberry Pi 4 (git 2.47, SD card), 30 commands each appending to a file, through the
same `CommandSnapshots` bundled into one script:

| | 5,000 files | 50,000 files, budget off | 50,000 files, as shipped |
|---|---|---|---|
| held before the command | 168 ms (max 231) | 294 ms (max 745) | 0 ms (the first: 401) |
| after it | 184 ms (max 252) | 615 ms (max 823) | 601 ms, not waited for |
| result | 30 of 30 with patches | 30 of 30 with patches | names for 29 of 30 |

The Pi's floor is starting git (three per snapshot), not the tree: 5,000 files cost half of
50,000. With a file changed, `add -A` rewrites the 50,000-entry index, which is what puts the
tree after a command past the budget there. The Daemon's RSS moved by under 9 MiB in each run.

## Consequences

- A command that isn't read-only starts two gits before it (`add`, `write-tree`) and four
  after it (the same two, `diff-tree`, `cat-file`); one that changed nothing stops at the trees.
- The two trees are held by no ref. `git gc` can prune one between the snapshots only with a
  prune expiry shorter than the command; then `diff-tree` fails and the command shows without
  files. The index's stale cached tree is checked as ADR 0109 describes.
- A command that changed files and whose result came first is stored twice in the event log,
  output included. Its changes come second because the tree after it is read while the
  Harness already has the result.
- Covered today: Claude Code sessions the Daemon runs. Not covered: Codex (its app-server
  reports a command when it has started, too late for a tree before it), sessions In Terminal
  (their hooks only observe and may not hold the TUI) and the user's own `!` commands.
- `CommandExecution.changes` is an optional key: an older Client ignores it and an older
  Daemon doesn't send it, so there is no capability for it.
