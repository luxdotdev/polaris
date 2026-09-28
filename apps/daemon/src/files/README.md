# files/

Read-mostly file access for Clients: `files.listDir`, `files.stat`, `files.read`, `files.searchPaths`, `files.grep`, `files.watch` (ENG-176, ENG-180).

## Design

- **Reach**: any path the Host user can read (`~` and relative paths resolve against the home directory). No Workspace sandbox, since SSH already grants a shell. M1 has no write RPCs.
- **`files.read`** (`fs.ts`): ranged reads (`offset`/`length`, clamped; `size` is always the whole file). The mime type comes from magic bytes, then the extension, then a text/binary sniff (`mime.ts`). Valid UTF-8 text of **256 KiB or less** (`INLINE_TEXT_MAX_BYTES`) is returned inline. Everything else goes through the `BlobChannel`: images, PDFs, binaries, larger text, and ranges that cut a UTF-8 character. Ranges over 4 MiB are streamed from disk instead of buffered.
- **Search and watch** (`FileSearch.ts`): one index per root (a Workspace or a Worktree), **built lazily** on the first search or watch and **dropped after 10 minutes idle** with no active watcher (`defaultFileSearchOptions`; a sweep runs every minute while any index exists, so an idle Daemon with none is never woken).
  - **fff** (`search/fff.ts`, `@ff-labs/fff-bun`, MIT): typo-tolerant path search with frecency, content grep, and a background watcher. Frecency and history databases go under `~/.polaris/fff/<hash of root>/`. We use the Bun build of fff (bun:ffi, no dependencies) rather than `fff-node` (ffi-rs); both come from the same repo and have the same API.
  - **Fallback** (`search/fallback.ts`), used when fff can't load or `POLARIS_FFF=off`: `git ls-files -co --exclude-standard` (or a capped walk outside git) plus a subsequence fuzzy scorer; `git grep` (PCRE if git has it, else ERE; `--no-index` outside repos); and `fs.watch` with 50 ms batching.
- Paths in search, grep and watch results are **absolute**. Grep lines and columns are 1-based. A watch `rescan` from fff (events were lost) is reported as `modified` on the root.
- **Handlers**: `FilesRpcsLive` is a partial `DaemonRpcs` handler layer. It needs `FileSearch` (`FileSearchLive()`) and, for each large read, `BlobChannel`.

## Build notes (for the lifecycle/build workstream)

- `bun build --compile` **embeds** fff's native library. On macOS nothing extra is needed. **On Linux, pass `--define FFF_LIBC='"gnu"'`** (or `'"musl"'`), or the library isn't embedded and fff falls back at runtime.
- Upstream's loader doesn't accept a path override, so there is no `POLARIS_FFF_LIB`. When the library isn't embedded, fff looks for it in `<dir of the binary>/../node_modules/@ff-labs/fff-bin-<platform>/`.
- `POLARIS_FFF=off` forces the fallback. `fffLoadError()` says why fff isn't in use.

## Known gaps / TODOs

- fff drops watch subscriptions made before its first scan finishes (upstream quirk), so `watch` waits for the scan and for `isWatcherReady` before it subscribes.
- The fallback's `fs.watch` doesn't filter gitignored paths; fff's watcher does.
- Regex syntax differs between backends: fff uses Rust regex, the fallback uses PCRE or ERE.
- The fallback path search isn't typo-tolerant and has no frecency.
