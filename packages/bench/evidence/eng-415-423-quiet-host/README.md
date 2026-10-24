# ENG-415 / ENG-423: RA and BW on a quiet Host

Before/after benchmarks for RA (ENG-398 authorization fixes, `cff83037`) and BW (ENG-418 Wire blob limit and Extension RPC admission, `e90d3aa0`), run on 2026-10-24 on the lead's Mac Studio (Mac14,13, M2 Max, 12 cores), with no other Polaris workers on the Host. All runs use the source Daemon, the bridge transport and `--runs 3`, under `polaris lease bench`, one tree at a time.

**Result: neither change has a reproducible regression.** Every committed-baseline failure also appears on the baseline's own commit, measured on the same day, so those failures come from the Host, not from the code. No baseline or tolerance was changed.

## Trees

| Label | Commit | What |
| --- | --- | --- |
| `ra0` / `ra1` | `3dc981c5` / `cff83037` | RA's base / RA |
| `bw0` / `bw1` | `2bd9844b` / `e90d3aa0` | BW's base / BW (contains RA) |
| `lead` | `173bca51` | the merged lead branch `lucas/eng-397-extensions` |
| `bl` | `83a04cb4` | the `env.gitSha` of the committed baseline `mac14-13-apple-m2-max-12c.json` |
| `idle-178826f8` | `178826f8` | the commit that re-saved the baseline's memory and idle rows for Bun 1.4.3 (idle only) |

Later commits refreshed some baseline rows without changing `env.gitSha`: `178826f8` (memory and idle), `8ae81716` (how `rss_before_mib` and growth are sampled) and `c078eeab` (`host_snapshot_kb`). So `bl` reproduces most of the baseline but not those rows. Suffixes: `-r` is a second pass in reverse order (after first), `-a`/`-b` are two more alternating BW pairs, and `-bun143` reruns on Bun 1.4.3, which the baseline's memory rows were saved with. Every other run used Bun 1.4.4.

```sh
bun run bench sessions history --runs 3 --compare packages/bench/baselines/mac14-13-apple-m2-max-12c.json          # ra0, ra1
bun run bench sessions history idle blobs terminal --runs 3 --compare packages/bench/baselines/mac14-13-apple-m2-max-12c.json  # bw0, bw1, lead, bl
```

`blobs` and `terminal` cover the Wire's blob channel; `sessions` covers JSON RPC fan-out to one and four Clients.

## Host conditions

Before each run, a script waited until the Host's busy cores, sampled with `top`, fell below a threshold. A 2-core threshold (the bench's `BUSY_BACKGROUND_CORES` warning) was never reached: macOS services (XProtect, fileproviderd, Spotlight) and open apps kept about 3 cores busy. The committed baseline was itself recorded with 2.5 busy cores. From the first run on, the threshold was 3 cores. The bench recorded 1.4 to 4.6 background cores across the runs (`env.backgroundCores` in each file). `progress.log` has every run's start, load average and exit.

## Results

Direct before/after comparisons, with the comparator's default tolerances (`comparisons/ab-*.txt`):

| Pair | Rows over tolerance |
| --- | --- |
| RA, forward (`ra0` → `ra1`) | 0 |
| RA, reversed (`ra0-r` → `ra1-r`) | 2: m50 ack p50 12.86 → 20.63, m50 dispatch-to-event p50 12.81 → 20.29 ms. This metric improved in the forward pass (18.48 → 16.05), so the row is noise. |
| BW, forward (`bw0` → `bw1`) | 1: m50c4 ack p50 13.26 → 20.27 ms |
| BW, reversed (`bw0-r` → `bw1-r`) | 2: m50c4 ack p50 12.59 → 22.75, m50c4 dispatch-to-event p50 14.98 → 28.22 ms |

The m50c4 rows appeared in both BW passes, so two more alternating pairs were run. Pooled over 12 runs per tree, the m50c4 ack p50 median is 14.95 ms before BW and 14.45 ms with it, and the dispatch-to-event p50 median is 18.30 vs 19.57 ms. In both extra pairs BW was faster (12.4 vs 15.4 and 14.3 vs 17.6 ms). For token-less Clients, which is what the bench uses, BW adds only a Map lookup and tag checks per message, nothing on the JSON hot path.

Against the committed baseline (`comparisons/baseline-*.txt`):

| Tree | Rows over tolerance |
| --- | --- |
| `bl`, the baseline's own commit | 12 (Bun 1.4.4), 13 (Bun 1.4.3) |
| `ra0` / `ra1` | 12 / 13 |
| `bw0` / `bw1` | 16 / 16 |
| `lead` | 14 (Bun 1.4.4), 16 (Bun 1.4.3) |

The same rows fail on every tree: m10/m50/m50c4 delta, event and dispatch-to-event p99, approval round trips, m10 CPU, idle no-Client RSS, repeat-phase RSS growth, and the blob and terminal peaks. Bun 1.4.3 does not bring `bl` back within tolerance, so the gap is neither the code nor the Bun upgrade. Today's Host does not reproduce the baseline's latency, CPU and peak-memory numbers.

Idle no-Client RSS (68.33 MiB in the baseline, 91 to 95 MiB on every tree) is bimodal: each run settles near 50–68 MiB or near 95 MiB. At `178826f8` itself the no-Client runs were 96.5/95.0/60.8 MiB on Bun 1.4.4 and 93.5/94.7/48.9 on Bun 1.4.3. The baseline's own client runs are 94.8/67.1/94.5. Its no-Client median caught three low runs; this is not a regression.

Comparing `lead` with `bl` directly on the same day (`ab-bl-lead*.txt`) flags `sessions rss_before_mib` (88–89 → 104–108 MiB) and `history host_snapshot_kb` (20.47 → 27.25 KiB). Both already match the committed baseline: `8ae81716` changed how `rss_before_mib` is sampled, and `c078eeab` recorded the larger Host snapshot. On Bun 1.4.3 that comparison also flags four m50c4 latency rows. They do not appear on Bun 1.4.4, and `bl-bun143`'s m50c4 values (ack p50 9.1 ms) are the lowest of all 16 sessions runs.

## Limits

- The Host is not idle: 1.4 to 4.6 background cores. CPU and throughput rows are not comparable in absolute terms, and the comparator says so in each file.
- Each tree has 6 runs (RA) or 12 runs (BW, m50c4 only). p99 latency rows carry 20–60% spread between runs of the same tree.
- Refreshing the committed baseline for this Host's current state is a separate decision. It was not done here.
