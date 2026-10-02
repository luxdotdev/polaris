# G2 Engine setup evidence

`after.json` measures clean implementation commit `6bafe5a96fe0aa498d32835754a05cb9020ec7f1`, including Harness `edaccdba` and Resources `6b2b7ade`. It runs the real source Daemon with temporary homes, the bridge transport and darwin-libproc sampling, on Bun 1.3.13. Setup uses no idle timer and remains inside the lazy Constellation layer.

```sh
bun run bench idle sessions --quick --runs 3 --compare packages/bench/baselines/mac14-13-apple-m2-max-12c-quick.json --json /private/tmp/c1-g2-engine-after.json
```

`before.json` is Harness's shared ecc8cf30 quick ×3 run. Its dirty flag represents untracked dependency symlinks; Harness reported unchanged tracked source. `resourceReference.json` is Resources' validated working-tree run before its bootstrap commit, also over ecc8cf30. It is a reference for the combined bootstrap cost, not an isolated setup-only measurement. `baseline.json` preserves the committed quick baseline used here, including Resources' documented m5 footprint refresh.

`comparisons.json` uses the benchmark comparator and its normal tolerances. Schema decoding currently drops the optional backgroundCores field, so comparison generation explicitly decoded and restored that field from each original result before calling the comparator. The raw files retain all provenance.

| Comparison | Gating exceedances |
| --- | --- |
| Shared before → Engine | 3: no-client RSS 74.30 → 127.36 MiB; m5 delta p99 6.01 → 13.21 ms; session RSS growth 101.06 → 128.09 MiB |
| Resources reference → Engine | 0 |
| Committed quick baseline → Engine | 8: both idle RSS and footprint rows, session initial RSS, burst deltas/s and MB/s, session RSS growth |

The before/reference/after runs started with 3.9/4.9/4.2 busy cores. CPU and throughput are not comparable under that load. Before no-client RSS samples were 134.14/74.30/72.11 MiB at unchanged source; after samples are 126.63/130.45/127.36 MiB. The overlapping spread limits interpretation of the RSS median flag. The m5 latency and session growth flags remain visible; zero flags against the Resources reference does not establish a clean performance pass.

Idle footprint medians are 93.72/92.70 MiB (client/no-client) before, 89.95/88.92 in the Resources reference, and 88.30/87.27 after. Wakeups remain about 13.20/10.50 per second after, with one process. These observations do not establish attributed memory savings or fulfillment of G1's full-run memory target. No baseline was edited by Engine.

The ordinary idle/sessions scenarios exercise the startup and Session hot paths, not a dependency download. Setup execution, failure, cancellation, retry and slot ordering are covered by focused tests and the real SQLite/Git production-composition test using controlled shell commands.
