# origins/

Origins (ENG-932, [ADR 0111](../../../../docs/adr/0111-origins-are-found-by-fingerprinting-what-each-turn-wrote.md)): the Agent Sessions and Turns that wrote a line or a commit, whoever committed it.

## How it works

- **Fingerprints** (`indexer.ts`): the `Origins` layer subscribes to the store for each Turn's after-checkpoint (`CheckpointRecorded` whose ref ends in `/after`), diffs the Turn's `before` and `after` checkpoint refs (`git diff -U0`, `git.ts`), and for each added line stores `(repoKey, lineHash, sessionId, turnId, path, workspaceId, at)` in `origin_fingerprints`, then marks the Turn in `origin_turns` (with no rows when its checkpoints are gone). `at` is when the after-checkpoint was recorded. Rows are written 500 to a transaction, so a large Turn never holds SQLite's write lock for long; a Turn past 50,000 distinct lines, or a diff past 32 MB, is a dump and the rest goes unindexed.
- **Matching is per file**: a fingerprint matches on `(repoKey, lineHash, path)`, the path the line had in the commit that introduced it (`git blame --porcelain`'s `filename`; the current path when uncommitted). A common line (`import { Effect } from "effect";`) written by a human in a file no agent touched so gets no Origin, and a later rename keeps the agent's. The primary key leads with `(repo_key, line_hash, path)`.
- **Line hash** (`lineHash.ts`): the line trimmed with each whitespace run collapsed to one space, SHA-256, the first 32 hex characters. A line with fewer than 12 letters or digits (`}`, `} else {`, `return null;`, blank) is too common to identify and gets no hash.
- **repoKey** (`git.ts`): the oldest root commit reachable from HEAD (committer time, then SHA), so every clone of the repository agrees across Hosts. Cached per Workspace for the Daemon's life; null on an unborn branch, and nothing is indexed then.
- **Backfill** (`indexer.ts`): once per database (`origin_state`), 2 minutes after start, every logged Turn of a git Workspace not yet in `origin_turns` is fingerprinted from its surviving checkpoint refs, one at a time with a 250 ms pause. A database with no git sessions (a new install) is marked done at once. A restart mid-way resumes where it stopped, and a Turn git failed on leaves the backfill undone, so the next start tries the Turns still unmarked (`Origins.backfillFinished` says how many failed).
- **Resolution** (`resolve.ts`, pure): a line's Origins are the fingerprints its hash matched in its own file from Turns before its commit's committer time (1 s grace, git's times are whole seconds; any time when uncommitted). A line without a hash takes the union of the Origins of the nearest identified lines above and below it in the same run (consecutive lines of the same commit); a human line in between stops the search. Every matching session and every matching Turn of each is kept.
- **Lifecycle**: `WorkspaceRemoved` purges the Workspace's sessions' rows in its commit (`store/projection.ts`, `SESSION_TABLES`); archiving keeps them; `Origins.forgetSession` deletes one session's (there is no Agent Session deletion command yet). The event log is the source of truth: the tables are a projection of it and the checkpoints, and the backfill rebuilds them from the refs that survive.

## RPCs (capability `origins`)

- `git.blame { workspaceId, worktreeId?, path, startLine, endLine }` → `{ repoKey, lines: [{ line, path, hash, commit }] }` (`git/blame.ts`): the file as it is on disk; uncommitted lines have `commit: null`; an untracked file is all uncommitted. `commit.time` is the committer time in epoch ms, which a rebase or squash moves later (author time would drop a squash's Origins).
- `origins.match { repoKey, lines: [{ line, path, hash, commitSha, commitTime }] }` (each line's `path` as `git.blame` gave it) → `{ lines: [{ line, origins }], sessions }`: from this Host's fingerprints only; the Desktop App asks every connected Host and merges. Send a hunk, not a single line: a skipped line can only inherit from the lines sent with it.
- `origins.forCommit { workspaceId, sha }` → `{ sessions }`: the union over the lines the commit added against its first parent.

`Origins` (`index.ts`) is a `Context.Service` provided once in `transport/serve.ts`'s `daemonServices`, so the MCP `origins` tool can share it.

## Bench

The live follower is one store subscriber that wakes only for an after-checkpoint; the backfill sleeps once and ends. Neither arms a timer on an idle Daemon whose backfill is done.
