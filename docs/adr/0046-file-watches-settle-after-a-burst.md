---
status: accepted
fixes: the flaky "open file watches survive consecutive atomic saves" test on ubuntu-latest
---

# File watches recheck once after a burst

Open files are watched through one shared watch on their parent directory
(`apps/daemon/src/files/watch.ts`), which survives atomic saves. On Linux,
Bun's `fs.watch` (1.3.13, `PathWatcher.emit` in `src/bun.js/node/path_watcher.zig`)
skips an event when the same watcher emitted another within 1 ms that had the
same event type or the same path. Every create, delete, rename and move is a
`rename`, so two such events in one directory within a millisecond, for any
two files, reach JavaScript as one. The kernel delivered both: `inotifywait`
beside the Daemon's watch saw the `DELETE` that Bun dropped.

Under load this lost the deletion of an open file after two atomic saves:
Bun reads a stale event from the first save together with the `DELETE`, and
the open tab never learns the file is gone. With three processes on two
busy CPUs a plain `fs.watch` lost the `DELETE` in about 3 of 100 runs; a
sibling's save and the open file's save written back to back lose the open
file's event almost every time.

## Decision

After every event, each directory watch arms a single 20 ms timer, reset by
later events. When it fires, every listener of that directory rechecks.
Whatever Bun dropped happened less than 2 ms after an event it delivered, so
it happened before the timer fires, and the recheck sees it.

An open file's recheck is a `stat`: it compares device, inode, size, mtime
and ctime with the stat taken before its last read, and only reads and hashes
the file when they differ. Directory listeners (language configuration) are
called as for an event; their flush already decides by manifest versions.

The timer runs only after an event and is unref'd, so an idle Daemon still
wakes for nothing.

## Rejected

- Fanning every event out to every listener: it covers a drop only when the
  dropped event was read in the same batch, and it reads every open file in
  the directory on every event.
- Notifying watches from the Daemon's own writes: it covers saves and deletes
  from the Desktop App but not other writers (git, editors, agents).
- Waiting for an upstream fix: still worth reporting, after which this can go.

Bun also skips directory events for names starting with `.` or `~` on Linux,
so an open `.env` saw external changes only until its first replacement.
ADR 0047 moves Linux directory watches onto inotify, which avoids both.
