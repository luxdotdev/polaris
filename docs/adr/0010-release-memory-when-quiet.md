# The Daemon gives memory back once it goes quiet after work

Two seconds after the last Turn in flight ends, with no other Turn in flight, the Daemon runs one full collection and `Bun.shrink()` (`apps/daemon/src/memory/`). It never schedules this while idle: a Turn end starts the timer, the next Turn end restarts it, and one release follows each quiet spell.

## Why

- **`sessions.footprint_growth_mib` looked like a regression, but no merge caused it.** The baseline (recorded at `14e1072`, 48 MiB) and main at `53a2dba` measured the same on the same afternoon: medians of 65 and 67 MiB over five runs each, 56–71 and 57–74 MiB per run. The earlier baseline's own runs spread from 34 to 68 MiB.
- **It is allocator high-water, not retained objects.** After the phases, the Daemon's live JavaScript heap is about 19 MiB. `vmmap` shows the growth in JavaScriptCore's allocator (`WebKit Malloc`, 40 → 102 MiB dirty), and the peak footprint reaches 196 MiB. Waiting ten more seconds or a full collection alone gave back only 5–10 MiB. How high the heap peaks before the collector catches up depends on how busy the machine is, so the metric followed the load (2.6 busy cores when the baseline was recorded, 5–11 now).
- **A collection plus `Bun.shrink()` returns those pages.** With it, footprint growth is 19 MiB (from 60–67), and latency, throughput and peaks are unchanged, because it runs only after the work. `idle` is unchanged, since an idle Daemon never runs it. On a Pi 4, or on a Mac running for days, it's the steady state that stays resident.

## Consequences

- One full collection per quiet spell. `shrink` may also drop JavaScriptCore's compiled code, so the next Turn can recompile hot functions: a few milliseconds, once.
- `bun-types` marks `Bun.shrink` deprecated, with no replacement. If a Bun upgrade removes it, typecheck fails there; `Bun.gc(true)` alone is the fallback, though it gives back only 5–10 MiB of the ~45.
- A Turn that ends while another runs doesn't release; a Daemon with a session always Working (a long agent) only releases between Turns.
