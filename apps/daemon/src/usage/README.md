# Usage index

One view of Usage (CONTEXT.md) on this Host, built from each Harness's own logs (ENG-205; decisions in ENG-199 Q8, Q17, Q18, Q20; research in `docs/research/usage-sources.md`). Capability `usage`: `usage.query` and `usage.watch`.

It is a **cache, not events**. The index lives in its own SQLite file (`~/.polaris/usage.sqlite`), never in the event store. Deleting the file only costs a rebuild. A change to the schema or to what a row means bumps `SCHEMA_VERSION` in `db.ts`, and the next open starts over.

Polaris never reads credentials here (ADR 0001). It reads the transcripts and rollouts the Harnesses write, and decodes only the lines that carry usage.

| File | Role |
|---|---|
| `scan.ts` | Reads what was appended to a log since a byte offset, in 256 KiB chunks, through one shared buffer, yielding to the event loop after each. It decodes only lines containing a marker, and leaves a line without its newline for the next pass. `writeInSlices` commits a file's rows ~4 ms at a time, yielding between. |
| `claude.ts` | Claude Code transcripts: line parsing and ccusage's dedup rules. |
| `codex.ts` | Codex rollouts: cumulative diffs, fork replay skipping, and the per-file parser state saved with the offset. |
| `indexer.ts` | Finding the logs, one pass per file (restarting a file that shrank or was replaced), and `indexLogs` with its garbage cadence. |
| `writer.ts` | Every statement the index runs, plus the bucket keys a pass touched. |
| `query.ts` | Hourly `UsageBucket`s: a `GROUP BY` joined to the Agent Session map. |
| `sessions.ts` | `UsageSessions`: Harness session ids (cursors) mapped to Agent Sessions, and Turn ends, taken from the event store. |
| `runner.ts` | `inProcessRunner`: one pass (link cursors, index the logs, record when it caught up) and the changes it made. |
| `passes.ts` | `passScheduler`: background passes, one at a time, requests coalescing into the next; the `indexing` announcement and end marker. |
| `changes.ts` | The `UsageChanged` buckets a short pass touched, and zero buckets for keys it emptied. |
| `UsageIndex.ts` | The `UsageIndex` service (refresh, query, changes) and the `PlanLimitSink` it implements. |
| `limitHistory.ts` | Plan Limit readings (`plan_limit_history`) and the weekly-per-5-hour-window estimate. |
| `UsageRpcs.ts` | The `usage.query` and `usage.watch` handlers. |

## Sources

- **Claude Code**: `<root>/projects/**/*.jsonl`. The roots are `$CLAUDE_CONFIG_DIR` (comma-separated, as ccusage reads it), else `$XDG_CONFIG_HOME/claude` (default `~/.config/claude`) and `~/.claude`.
- **Codex**: `$CODEX_HOME/sessions/**/*.jsonl` and `archived_sessions/`. When the same relative path is in both, the active copy wins.
- **OpenCode** (`opencode.db`) waits for its Harness driver (M1.5); it isn't in the catalogue yet.

## Rules (adapted from ccusage)

Adapted from ccusage/ccusage@0dd85c1 (MIT; see `ATTRIBUTION.md`). The goal is ccusage's token totals, so every rule below matches its behaviour:

- **Claude**
  - **Which lines count:** a line counts if it carries `message.usage` and a timestamp, and passes ccusage's validity checks: `version` is semver, and none of the ids or the model is empty.
  - **Tokens:** `input` = `input_tokens`, `cacheRead` = `cache_read_input_tokens`, `cacheWrite` = the 5-minute plus 1-hour `cache_creation` split (else `cache_creation_input_tokens`), with the 1-hour part also in `cacheWrite1h`, `output` = `output_tokens`.
  - **Models:** `<synthetic>` replies are skipped. Fast mode is reported as `<model>-fast`, because it is priced apart. Advisor iterations count separately, under their own Model.
  - **Dedup:**
    - With a request id, a response is `message.id` + `requestId`, across sessions (Claude Code copies responses into resumed transcripts). Without one, it is message id + session + timestamp.
    - On a duplicate, a parent beats a sidechain copy, then more tokens win, then fast mode.
    - A sidechain (`/btw`, subagents) replaying a parent message counts once, even with a new request id at the same timestamp. A response copied into another session leaves an alias, so that session's replays find it too.
  - **Reported cost:** `costUSD` is kept where old transcripts have it.
- **Codex**
  - **Deltas:** `event_msg`/`token_count` lines. `last_token_usage` is the Turn's delta. A total that didn't advance is skipped. Without a delta, the previous cumulative total is subtracted.
  - **Tokens and Model:** cached and written input are part of `input_tokens`, so `input` is what remains after both. Reasoning is part of `output`. The Model comes from the latest `turn_context`. A usage event with no Model yet reports `unknown`: ccusage's `gpt-5` fallback is only a pricing guess.
  - **Service tier:** `thread_settings_applied` sets it, as ccusage reads it. `priority` or `fast` makes later responses `<model>-fast` (priced apart, like Claude's fast mode). `default` or `standard` resets it, and a settings event without a tier leaves it unchanged. The dedup key keeps the logged Model.
  - **Forks and subagents** (`forked_from_id`, `source.subagent.thread_spawn.parent_thread_id`):
    - The child's head replays the parent's usage stream, up to the fork's time, and that part isn't counted.
    - When nothing matches (the parent log is gone, or Codex rewrote the history), a burst of usage events less than a second apart at the child's head is skipped instead.
    - Every file's raw stream is kept (`codex_stream`) so a later child can match it.
  - **Dedup across files:** the same timestamp, Model and token counts is one response. This also keeps a rollout that moved to `archived_sessions/` from counting twice.

One ccusage behaviour is not carried over: OpenAI's `codex-auto-review` Model-alias timeline. We report the Model the log names, and the Client leaves it unpriced.

## What pricing needs (ENG-207)

A price list bills per request, and a bucket is an hour's sum. So each row also keeps what a sum can't recover:

- **`cacheWrite1h`**: one-hour cache writes cost more than five-minute ones.
- **`context`**: the request's whole prompt (input, cached or not).

A bucket reports `longContext`: the tokens of its requests whose prompt was over 200k, and over 272k. These are the thresholds where Anthropic and OpenAI switch a request to long-context rates. The Client prices those tokens at the long rates and the rest at the base rates (`packages/client/src/usage/`). Adding these fields bumped `SCHEMA_VERSION` to 2, so the index rebuilds once.

## Linking Usage to Agent Sessions

A bucket's `sessionId` is the Agent Session whose cursor (`SessionCursorUpdated`) is that Harness session id. That is a Claude `sessionId` or a Codex thread id. Usage outside Polaris has `null`, and `usageShare` in `@polaris/protocol` gives Clients the "through Polaris" split.

The map lives in the index (`session_map`). A new index backfills it once from every session's events, and later passes only add current cursors. While the Daemon runs, new cursors arrive live. Linking a cursor that already has Usage moves its buckets: `usage.watch` sends them under the Agent Session, plus zero buckets where they were.

## When it runs

Nothing runs on a timer. An idle Daemon never opens the index: the `idle` scenario is unchanged.

**Passes never block the Daemon** (ADR 0009). A pass runs in the background, on the Daemon's thread, in bounded steps: a 256 KiB chunk of one log, or ~4 ms of writes in one transaction, then a yield to the event loop. The WAL checkpoints every 64 pages, so no commit stalls on a big checkpoint. Session streams and RPCs keep flowing while it reads gigabytes. Passes run one at a time; a request made during a pass joins the next one.

- **`usage.query`** starts a pass (only the bytes appended since the last one, per file). It waits up to ~250 ms for the pass, then answers from what is indexed, with `indexing` true while the pass still runs.
- **`usage.watch`** doesn't index by itself. A Client that only wants Plan Limits (the Desktop's Harness menu) costs no log reading.
- **Once a Client has queried the index in this Daemon:**
  - **After each Turn** (`TurnEnded` from the event store), a pass runs over that Harness's logs.
  - **While at least one Client watches,** the Daemon runs `fs.watch` (recursive) on the log roots. Changes settle for a second, then a pass runs; the watchers close with the last subscriber.
  - **A new watcher** starts a catch-up pass.
- **What watchers hear:**
  - **A short pass** (under 300 ms) publishes a `UsageChanged` with every bucket in the hours it touched (a Client replaces buckets by key). It also sends zero buckets for keys it emptied: that happens when a replaced Claude response moves to another Model, or a relink moves Usage to an Agent Session.
  - **A longer pass** (the first over large logs) is announced: `UsageChanged` with `indexing` true and no buckets. It ends with `indexing` false and no buckets, because it may have changed thousands, and building and encoding them would stall the Daemon. A Client showing Usage queries again on that end marker.

## `usage.watch` and Plan Limits (the ENG-206 interface)

`usage.watch` is shared. This module owns the stream; the Plan Limit work only reports values:

```ts
const sink = yield* PlanLimitSink; // services.ts, provided by UsageIndexLive
yield* sink.report(new PlanLimit({ harness: "claude", kind: "five-hour", ... }));
```

- A limit's key is (`harness`, `kind`, `scope`). `report` keeps the latest value per key, persists it in the index (`plan_limits`), and publishes `PlanLimitChanged` to every watcher.
- A new subscriber first gets every known limit, persisted ones included, so Clients can show the last value with its age after a restart. Then it gets live `UsageChanged` and `PlanLimitChanged` items.
- `serve.ts` provides `PlanLimitSink` beside the other Daemon services. The drivers report through `PlanLimitReporter` (`../harness/limits/`), which sits in front of it and drops stale and repeated readings.
- Each reading with a percentage and a reset also goes into `plan_limit_history` (`limitHistory.ts`): pruned on the same write to a week and 5,000 rows per window, so there's no timer and no idle cost. From it, a whole-plan weekly limit carries `weeklyPerSession`, the median weekly share a full 5-hour window used over the last seven finished ones (null below three), for the Client's "full 5-hour windows left" forecast. The pace and the run-out projection need no history: the Client derives them from one reading and the window's length.
- `UsageIndexOptions.planLimitSeed` gives last known values from the Harnesses' own logs (Codex's rollouts). It runs on a new `usage.watch` (at most once a minute) before the known values are sent, and after a pass over that Harness's logs; it never replaces a newer value.

## Cost

Measured with `bun run bench usage usage-contention` on synthetic logs (M2 Max, 3 runs, medians):

| Log set | First build | Peak footprint over base | No-op refresh | 100 lines appended | Index file |
|---|---|---|---|---|---|
| 1.1 GB (full) | 4.5 s (242 MB/s) | 24 MiB (RSS 59 MiB) | 105 ms | 107 ms | 26 MiB |
| 89 MB (quick) | 0.4 s | 26 MiB (RSS 42 MiB) | 11 ms | 13 ms | 2 MiB |

**While the first pass runs** (`usage-contention`, 2.7 GB): a Client streams a session and times an RPC every 50 ms on the same connection that opens the Usage view.

| | Before (one blocking pass) | After (bounded steps) |
|---|---|---|
| First `usage.query` | 26 s | 280 ms |
| First pass | 26 s | 12.9 s |
| RPC p99 / worst during the pass | 34 / 687 ms | 11 / 18 ms |
| Session delta, worst lateness | 50 ms | 13.5 ms |

On this Mac's real logs (3.6 GB: 1.5 GB Claude, 2.1 GB Codex), `scripts/usage-vs-ccusage.ts` builds the index in 17–24 s, with a 140–170 MiB peak process RSS (Bun itself is about 75 MiB of that).

What keeps memory flat, which matters on a Pi 4:

- **Chunked reads:** 256 KiB reads into one shared buffer.
- **Codex's long lines are skipped:** its usage types always sit in a line's first bytes, so a multi-megabyte tool output without one is never buffered or decoded.
- **Garbage cadence:** a full GC after every 64 MiB of logs read (a few ms at most, even with a busy Daemon's heap).
- **Nothing held in memory:** dedup state lives in SQLite, not in maps.
- **No second thread:** a Bun Worker costs ~45 MiB more, because it loads its own Effect (ADR 0009).

A later pass reads only appended bytes. Its cost is mostly the bucket query: about 0.7 µs per row in the range, 98k rows in 70 ms. An hourly rollup table would make wide ranges cheaper if that ever matters.

## Checking against ccusage

```sh
bun --cwd apps/daemon scripts/usage-vs-ccusage.ts          # days before today, UTC
```

The script builds a fresh index from this Host's real logs. It compares per-day input, cache read, cache write and output against `bunx ccusage@20.0.26 {claude,codex} daily --json --timezone UTC --offline`, the ccusage version at the pinned commit. Today is left out, since running sessions write between the two reads. On 2026-09-29 on this Mac: **no difference on any day**. That was 27 days and 6,796,184,416 Claude tokens, and 70 days and 6,415,285,542 Codex tokens.

## Tests

- `indexer.test.ts`: fixture logs for every rule above, plus incremental passes (a line without its newline yet, truncation, a huge Codex line).
- `nonBlocking.test.ts`: a session stream (real engine and event store, a fake Harness streaming a delta every 10 ms) keeps delivering while the first pass runs over ~220 MB. Deltas arrive at most ~45 ms late, where the same pass without yields and write slices holds them ~300 ms. `usage.query` answers from a partial index, marked `indexing`, and the end marker comes with every response indexed.
- `UsageIndex.test.ts`: the service through its RPCs:
  - It opens nothing until asked, and a watch for Plan Limits alone reads no logs.
  - The Polaris / outside split and the filters.
  - `usage.watch` with the file watcher and Plan Limits.
  - A relink moving Usage, and a Turn end catching up.
  - Plan Limits surviving a restart.
