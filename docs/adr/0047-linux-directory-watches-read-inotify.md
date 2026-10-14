---
status: accepted
fixes: open `.env` tabs on Linux missing every change after the first atomic save
---

# Linux directory watches read inotify themselves

The Daemon's shared directory watches (`apps/daemon/src/files/watch.ts`: open
file tabs, `git.watch`, the language configuration watch) and the fallback
search watch (`files/search/watch.ts`) used Bun's `fs.watch`. On Linux, Bun
1.3.13 drops every directory event whose entry name starts with `.` or `~`
(`PathWatcherManager.onFileUpdate` in `src/bun.js/node/path_watcher.zig`).
It does deliver writes to entries that existed when the watch started, through
a per-file inotify watch on an fd it opened then. That fd keeps the old inode,
so once the file is replaced by a rename, nothing about it arrives again:

| `.env` (or `~env`), watch held on its directory | Bun `fs.watch` | `env` |
|---|---|---|
| in-place write before any replace | `change` | `change` |
| replace (temp `tmp-x` renamed over it) | only `rename:tmp-x` | `rename:tmp-x` |
| replace with a dotted temp (as `files.write` does) | nothing | `rename:env` |
| in-place writes after the replace | nothing | `change` |
| delete, re-create, write | nothing | `rename`, `change` |
| created after the watch started | nothing | `rename` |

A file-level `fs.watch` does not help. Bun keys its watch list by path and a
removal only takes effect after the next event batch, so a watch re-armed on
the replaced file reuses the stale entry and sees nothing, alone or beside the
directory watch. Bun also never reports the old inode's deletion, since it
holds that inode open.

## Decision

On Linux the Daemon opens one inotify instance through `bun:ffi`
(`apps/daemon/src/files/inotify.ts`), adds a watch per directory (create,
delete, both halves of a move, modify, attributes, the directory itself) and
reads it with `Bun.file(fd).stream()`, which waits in the event loop's epoll:
no thread, timer or poll while nothing changes. The instance opens with the
first watch and closes with the last. A queue overflow notifies every watch.
Where `libc` can't be loaded, the watches stay on `fs.watch`. macOS keeps
`fs.watch`, which has no such filter there.

This also avoids Bun's 1 ms merge (ADR 0046) and its opening an fd for every
entry of a watched directory. The settle recheck stays: it is cheap and still
needed wherever `fs.watch` is used.

The stream's pending read holds the event loop open while a watch exists,
where `fs.watch` was `persistent: false`. Every watch is scoped to a Client's
stream or a Workspace, so it is released on shutdown.

## Rejected

- A file-level `fs.watch` per dotted name, re-armed after a replace: Bun reuses
  the stale entry (above).
- The ADR 0046 `stat` recheck on a timer: polling wakes an idle Daemon.
- Rechecking dotted names on other events in the directory: an edit to `.env`
  alone produces none.
- Waiting for Bun: drafts for both reports are in
  `docs/research/bun-fs-watch-linux.md`. Once fixed upstream, `inotify.ts` can go.
