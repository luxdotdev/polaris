# @polaris/bench

Benchmarks for the Daemon: memory, CPU and latency, measured on the real `polaris serve` driven through `@polaris/client` exactly as a Client drives it. Performance is a product requirement (PRODUCT.md): the Daemon has to stay light on a Raspberry Pi 4 and a small Linux VM as well as on a Mac, and the Desktop App has budgets of its own (< 1 GB in a heavy session, ≥ 120 Hz, Workspace switch < 100 ms). This package is where those numbers are measured and guarded.

```sh
bun run bench                       # every scenario, full sizes, one run
bun run bench sessions idle         # just these
bun run bench --quick               # small sizes (what CI runs)
bun run bench --runs 3 --compare packages/bench/baselines/mac14-13-apple-m2-max-12c.json
bun run bench --list
```

Each scenario run gets a **fresh Daemon** with a throwaway `POLARIS_HOME` (under `/tmp/polaris-bench/`), started from source (`bun apps/daemon/src/main.ts serve --foreground`) or, with `--binary`, a compiled build from `scripts/build-daemon.ts`. Clients connect through `polaris bridge` (what `ssh <host> polaris bridge` runs), or with `--transport socket` straight to the Unix socket. The Daemon is stopped and its home removed afterwards.

## Options

| Option | What |
|---|---|
| `[scenario...]` | Scenarios to run (default: all), see below. |
| `--quick` | Smaller sizes: seconds instead of minutes. CI runs this. |
| `--runs N` | Run each scenario N times (fresh Daemons every time); every metric reports the median, with the min–max range. |
| `--json PATH` | Also write the result JSON to PATH. |
| `--compare PATH` | Compare with a baseline JSON; exits 1 on a regression beyond tolerance. |
| `--fail-on KINDS` | Which metric kinds gate `--compare` (default all): `memory,cpu,latency,time,throughput,count`, or `none`. |
| `--save-baseline` | Write the result to `baselines/<machine>[-quick].json`. |
| `--markdown PATH` | Append a Markdown summary (e.g. `$GITHUB_STEP_SUMMARY`). |
| `--profile` | CPU profile and heap snapshot for each scenario run (below). |
| `--binary PATH` | Bench a compiled `polaris` instead of the source. |
| `--transport bridge\|socket` | How Clients connect (default `bridge`). |

Relative paths are resolved against the repository root. Every invocation also writes `packages/bench/results/<timestamp>/` (git-ignored): `result.json`, `summary.txt`, `comparison.txt` and any profiles.

## Scenarios

Sizes are full / `--quick`.

| Scenario | What it does | Key metrics |
|---|---|---|
| `cold-start` | Spawns the Daemon 5 / 3 times; polls `hello` on the socket every 2 ms. | `hello_ms` (spawn → first successful hello), `rss_settled_mib` and `footprint_settled_mib` 2 s later, `bridge_connect_ms` (spawn `polaris bridge` → hello). |
| `idle` | 3 Workspaces (git repos), 6 Agent Sessions that ran a Turn and went Dormant across a Daemon restart. 30 s / 10 s with one Client subscribed, then the same with none, beside a bare Bun process as the floor. | CPU % (100 = one core), wakeups/s, RSS. Notes flag CPU or wakeups above the bare-Bun floor. |
| `sessions` | Concurrent Agent Sessions on the scripted Harness: phases `m10`, `m50`, `m50c4` (C = Clients, all subscribed to every session) / `m5`, `m10c3`, then `burst` and `repeat`. Realistic Turns: 10 items, 6 of them streaming 20 deltas at 50/s, one approval. | `dispatch_ack`, `dispatch_to_event` (SendTurn → its `TurnStarted` at the Client), `delta_latency` (Harness emit → Client receive, from the timestamp in each delta), `event_latency` (commit → Client, 1 ms resolution), `approval_round_trip`, CPU, peak RSS; `burst.deltas_per_s` (one session streaming without pause: the pipeline's ceiling); `rss_growth_mib` and `rss_growth_repeat_mib` (the biggest phase again: a leak steps up twice). |
| `history` | Seeds 20 sessions × 50 Turns × 96 items / 5 × 20 × 46 (~100k / 5k events) through the Daemon, then restarts onto the store. | `seed_events_per_s` (commit throughput), `restart_hello_ms`, `loaded_rss_mib` (the read model keeps every Turn in memory), `host_snapshot_ms`, `session_snapshot_full_ms` / `_last10_ms`, `host_resume_10k_ms`, `session_resume_half_ms`, snapshot sizes. |
| `blobs` | 100 / 16 MiB of incompressible bytes: `files.read` (Daemon → Client) and `attachments.stage` (Client → Daemon). RSS sampled every 50 ms. | MB/s each way, peak RSS over the pre-transfer level, RSS retained after. |
| `files` | A generated, committed repo of 50k / 5k files (~1.5 KB each, cached in `/tmp/polaris-bench/fixtures/`). Path search and grep, first with fff and then with the git fallback (`POLARIS_FFF=off`), each in its own Daemon. | `first_search_ms` (builds the index), `search_p50/p95_ms`, `grep_p50/p95_ms`, `index_rss_mib`. |
| `git` | A private copy of the same tree; 5 / 3 scripted Turns each rewriting 20 files, so the engine captures real checkpoints. | `checkpoint_before_ms` (SendTurn → `CheckpointRecorded(before)`), `checkpoint_after_ms` (last item → `CheckpointRecorded(after)`), `turn_diff_ms`, `status_ms`, `working_tree_diff_ms`. |
| `terminal` | A `Bun.Terminal` running `yes … \| head -c 50M` / `10M`, attached through `attachTerminal` (raw bytes on the blob channel when the Daemon has `terminal.binary`). On macOS most of the CPU is the PTY itself: Bun reads it ~66 bytes at a time, ~36 ms of CPU per MB before the Daemon does anything. | `mb_per_s`, CPU, peak RSS over base. |

Scenarios are independent and each starts its own Daemons, so any subset can run alone.

## The scripted Harness

`POLARIS_BENCH_HARNESS=1` makes `HarnessRegistryLive` (`apps/daemon/src/harness/registry.ts`) register `apps/daemon/src/harness/bench/BenchDriver.ts` for every Harness kind instead of Codex and Claude. It spends no tokens and starts no vendor process, but its events go through the real engine, store, streams and transport. A prompt `bench:{json}` sets the Turn's script (`TurnScript` in `src/drive.ts` mirrors it):

| Field | Default | What |
|---|---|---|
| `items` | 5 | Completed items per Turn; kinds rotate message, reasoning, command, tool call, file change. |
| `deltasPerItem` | 10 | Deltas streamed before each message, reasoning and command item. |
| `deltaBytes` | 64 | Bytes per delta. Each starts with `@<epoch ms>\|`, its emit time. |
| `deltaIntervalMs` | 5 | Pause between deltas; 0 = as fast as the engine takes them. |
| `approvalEvery` | 0 | Every Nth item first asks for an approval and waits for a Client's answer. |
| `touchFiles` | 0 | Files written under `<cwd>/polaris-bench/` during the Turn (for checkpoints and diffs). |
| `itemBytes` | 0 | Minimum text size of each completed text item. |
| `startDelayMs` | 0 | Pause before `TurnStarted`. |

## The sampler (reusable)

`src/sampler.ts` samples a **process tree**: the roots you give it and all their descendants (for the Daemon: Harness processes, git, terminals), at a fixed interval, and reports min / median / p95 / max of RSS and footprint, per-interval CPU %, average CPU, CPU seconds, wakeups/s and a per-process peak table. It is exported (`@polaris/bench/sampler`) so the Desktop App can reuse it with the Electron main process as the root (renderers and helpers are its children).

`src/proc.ts` reads the counters without spawning anything:

- **macOS**: `proc_pid_rusage(RUSAGE_INFO_V2)` via `bun:ffi` gives RSS, **physical footprint** (what Activity Monitor shows as Memory: compressed and swapped pages included, shared file-backed pages excluded), user + system CPU (mach time converted with `mach_timebase_info`), idle + interrupt **wakeups**, and CPU of reaped children. `proc_listchildpids` walks the tree.
- **Linux**: `/proc/<pid>/stat` (CPU in clock ticks at `USER_HZ` = 100, reaped children included), `/proc/<pid>/status` (VmRSS; footprint = RssAnon + RssShmem) and the voluntary + involuntary **context switches** of all threads as the wakeup count. Children from `/proc/<pid>/task/*/children`.
- Fallback (or `POLARIS_BENCH_PS=1`): `ps` for RSS and CPU only (10 ms CPU resolution on macOS, whole seconds on Linux).

CPU is the change of user + system time over the tree between samples (including children that exited and were reaped in between) divided by wall time: 100% = one core. Prefer footprint over RSS when judging memory on macOS: RSS counts shared libraries and pages the allocator keeps but the system can reclaim.

## Results and baselines

A result is JSON: `env` (machine model, CPU, cores, RAM, OS, Bun version, git sha and dirty flag, source vs compiled, transport, sampler backend, date), `options`, and per scenario its metrics (`value` is the median over runs, with `runs`, `min`, `max`, `unit`, `kind`, `better`), notes and duration.

Baselines live in `baselines/`, named by machine slug (`<model>-<cpu>-<cores>c`, plus `-quick`):

- `mac14-13-apple-m2-max-12c.json`: the lead's Mac Studio (M2 Max, 32 GB), full suite, median of 3 runs, source Daemon, bridge transport.
- `mac14-13-apple-m2-max-12c-quick.json`: the same at `--quick` sizes, for fast before/after checks.

Other apps were running on the machine while these were recorded (it is a workstation, not a lab), so treat single-digit-percent differences as noise; the tolerances below account for it.

**Updating a baseline** (after an intended change, or on a new machine): close heavy apps, plug in, then

```sh
bun run bench --runs 3 --save-baseline                # full; writes baselines/<machine>.json
bun run bench --quick --runs 3 --save-baseline        # writes baselines/<machine>-quick.json
```

and commit it with a message saying why the numbers moved. Never regenerate a baseline to make a regression disappear: fix it, or explain it in the commit.

**CI** (`.github/workflows/ci.yml`, job `bench`): `--quick` on `ubuntu-latest`, summary in the job's step summary, result JSON uploaded as the `bench-result` artifact. It is **report only**, on purpose. GitHub hands out different CPU models from run to run (the first two runs landed on AMD EPYC 7763 and 9V74), and retained and peak memory moved 30–80% between them, so a runner baseline can't gate anything reliably. Gate on a fixed machine instead: compare locally against `baselines/<machine>.json`, or (later) a self-hosted runner with its own committed baseline. If a stable runner exists, commit its artifact as `baselines/ci-ubuntu-latest-quick.json` and the job fails on memory regressions beyond tolerance (`--fail-on memory`). Latency and CPU never gate CI: shared runners are too noisy.

## Comparing and tolerances

`--compare baseline.json` prints every metric with its change and status, warns when the machine, sizes (`--quick`), Daemon build or transport differ, and exits 1 when a gating metric is worse than the baseline by more than `max(relative × baseline, absolute)`:

| Kind | Relative | Absolute | Why |
|---|---|---|---|
| memory, steady state (MiB) | 10% | 5 MiB | Settled, idle and loaded RSS / footprint repeat within ~3% run to run; this catches a real step (a leak, a new cache) without flagging allocator jitter. |
| memory at a peak, grown, or left after activity (`peakMemory`) | 25% | 10 MiB | Depends on when the GC ran: 15–30% spread between runs of the same build. |
| memory in `blobs` | 35% | ¼ of the payload | Transfers allocate in proportion to the payload and their peaks move with GC timing. |
| cpu (% of a core) | 50% | 2 points | CPU under load spreads ~10–20% between runs, light-load CPU much more. |
| latency (ms) | 50% | 5 ms | p50s of a few ms and p99 tails swing by several ms; the absolute floor keeps them from flapping. |
| time (ms) | 35% | 5 ms | Whole operations (start-up, snapshots, checkpoints, first search) repeat within a few %. |
| throughput (/s) | 30% (50% in `blobs`) | 0 | A drop of a third is a real slowdown; blob transfers are noisier. |
| count | 25% | 1 | Sizes and counts that should not change much. |

A metric can override its tolerance (idle CPU, for example, is held to 0.3 points over a bare Bun process), and informational metrics (`info`) never gate. The numbers come from the spread of the three runs behind the Mac Studio baseline (the `range` column of a `--runs 3` table shows it for any machine). If a metric flaps, loosen that metric's tolerance in its scenario with a comment saying why; do not loosen the defaults.

## Profiles and snapshots

`--profile` adds, per scenario run, into `results/<timestamp>/<scenario>-run<N>/`:

- **CPU profile** of the Daemon: `bun --cpu-prof --cpu-prof-md` (for a compiled binary, the same flags through `BUN_OPTIONS`), written when the Daemon exits: a `.cpuprofile` (Chrome DevTools → Performance, or speedscope) and a grep-friendly `.md`.
- **Heap snapshot** at the scenario's peak (after its measurements, so the snapshot's own allocation does not skew them): `heap-<label>.heapsnapshot`, V8 format, open in Chrome DevTools → Memory.

Profiled numbers include the profiler's overhead; `--compare` warns about it.

The hooks live in the Daemon, off by default (`apps/daemon/src/debug.ts`):

- `POLARIS_DEBUG_DIR=<dir>`: `SIGUSR1` runs a full GC and writes a heap snapshot into `<dir>` (SIGUSR2 is taken by upgrades).
- `POLARIS_DEBUG_STATS_MS=<ms>`: one JSON line on stderr every `<ms>` with `process.memoryUsage()` and the event-loop lag, for watching a live Daemon.

## Adding a scenario

Add `src/scenarios/<name>.ts` exporting a `Scenario` and list it in `src/scenarios/index.ts`. Use `ctx.launch()` for Daemons and `ctx.sample()` for samplers (both cleaned up for you), `src/drive.ts` to dispatch and watch sessions, and the metric constructors in `src/types.ts` (`memory`, `cpu`, `latency`, `time`, `throughput`, `count`) so comparisons know the kind. Keep `--quick` sizes to seconds.

## Known gaps

- The sampler measures the Daemon only; the `polaris bridge` processes (and ssh) are Client-side and not included.
- Wakeups are not comparable across platforms: macOS counts idle and interrupt wakeups, Linux counts context switches.
- History is seeded through the Daemon, so full sizes take a while (commit throughput is itself a metric); a much larger store (1M events) would need a direct SQLite seeder.
- No Desktop App scenarios yet (there is no Desktop App); the sampler is ready for them.
