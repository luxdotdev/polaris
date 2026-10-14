# Bun `fs.watch` on Linux: two upstream reports (drafts, not filed)

Polaris works around both in `apps/daemon/src/files/inotify.ts` (ADR 0046, ADR 0047).
Seen on Bun 1.3.13 (`oven/bun:1.3.13-debian`, arm64 and x64); line references are to
`bun-v1.3.13`.

## 1. Directory watches drop every event for names starting with `.` or `~`

`PathWatcherManager.onFileUpdate` (`src/bun.js/node/path_watcher.zig`, the `.directory`
branch) skips `changed_name[0] == '~' or changed_name[0] == '.'`. Node reports these.
Writes to dotfiles that existed when the watch started still arrive through the per-file
watch Bun adds while enumerating the directory, but that entry holds the old inode's fd, so
after an atomic replace (write a temp file, rename it over) nothing about the file arrives
again, and a dotfile created after the watch is never reported.

```ts
import { appendFileSync, mkdtempSync, renameSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "w-"));
const file = join(dir, ".env");
writeFileSync(file, "a");
watch(dir, (event, name) => console.log(event, name));
await Bun.sleep(100);
writeFileSync(join(dir, "tmp"), "b");
renameSync(join(dir, "tmp"), file); // Bun: "rename tmp" only; Node: also "rename .env"
await Bun.sleep(100);
appendFileSync(file, "c"); // Bun: nothing; Node: "change .env"
await Bun.sleep(100);
unlinkSync(file); // Bun: nothing; Node: "rename .env"
await Bun.sleep(100);
process.exit(0);
```

Expected: the same events as with `env`. Closing the watch and opening a new one on the
same path in the same process does not recover: removals from the shared watch list take
effect only after the next event batch, so `addFile` finds the stale entry by path hash.

## 2. Events less than 1 ms apart are merged when they share a type or a path

`PathWatcher.emit` skips an event when the previous one on that watcher came within 1 ms and
had the same event type or the same path hash (the condition reads as "different type and
different path, or more than 1 ms later"). Every create, delete and rename is `rename`, so
two files renamed in one directory back to back report only the first.

```ts
import { mkdtempSync, renameSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "w-"));
const seen: string[] = [];
watch(dir, (event, name) => seen.push(`${event} ${name}`));
await Bun.sleep(100);
writeFileSync(join(dir, "a"), "1");
writeFileSync(join(dir, "b"), "1");
renameSync(join(dir, "a"), join(dir, "c"));
renameSync(join(dir, "b"), join(dir, "d"));
await Bun.sleep(100);
console.log(seen); // Bun: ["rename a"] (3 of 3 runs); Node: a, b, c and d
process.exit(0);
```

Expected: one event per kernel event, as Node does; deduplicating only identical
consecutive events (same type and same path) would keep the intent.
