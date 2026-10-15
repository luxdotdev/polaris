# Scored next-edit replay

The five category JSON files contain only step 4 of the 30 cases from the Polaris next-edit spike, at parent contract commit `d5128595f5f81b95533cb076f281dc46f8d3b490`. Sources: `docs/research/next-edit-spike/scripts/cases.json`, the git commits named there, `raw/zeta-q4-frozen-ngram.jsonl`, `raw/sweep-q8-ngram.jsonl`, their `.labels.json`, and `raw/judgement.json`. No external source code was copied.

Buffers and history are reconstructed by the spike's `buildCase`. Expected and allowed ground-truth files are stored as line patches to avoid repeating whole files. `exact.json` freezes reviewed minimal UTF-16 hunks for the exact-labelled outputs. Tests apply those hunks and independently compare the resulting buffer to the commit-derived ground truths.

The spike's exact rule ignores whitespace and allows extra hunks from the same commit. Zeta `rf01` preserves a one-line ternary where the commit formats it across three lines: it is exact by that rule, but not byte-exact. This is explicitly asserted and reported. Both formats' `rf03` include a second allowed hunk from the same commit. Sweep `rn07` has whitespace-only drift and is an abstention under the spike rule.

## Live hardening, 2026-10-15

`hardening-cases.json` freezes 100 inputs from Polaris history, with source commit, path and hunk selections in `docs/research/next-edit-spike/scripts/cases.json`. The original 30 cases are dev cases; 70 new cases add 14 per category. New cases apply all non-target hunks as history. Insertion cases then type 40% of the target's first line. Ground truth is derived from git, not from model responses.

The split was fixed before inference: 70 dev, 30 held-out (six of each category). Within each category, the 14 new manually selected cases were sorted by SHA-256 of `ep1b:<commit>`; the first eight go to dev. Commits do not cross splits; paths can. This is a small, selected TypeScript/TSX workload, not a random repository or language sample.

- `hardening-dev.json` / `hardening-test.json`: Sweep Next-Edit 1.5B raw responses.
- `hardening-zeta-dev.json` / `hardening-zeta-test.json`: Zeta 2.1 Q4_K_M raw responses.
- Corresponding `.labels.json`: every response's rubric label and review note; acceptable responses also freeze reviewed minimal hunks.
- `hardening.meta.json`: settings, source hashes frozen before held-out inference, and measurement boundaries.
- `hardening-summary.json`: raw and post-guard counts by model and split; full non-exact reviews are in `docs/research/next-edit-spike/raw/live-hardening.review.md`.

Exact and abstain are mechanically checked against the spike's whitespace-insensitive rule. Other labels were reviewed against the frozen history, existing code and commit-derived target. An acceptable insertion can complete a correct first line while leaving later target lines to the user. A dangerous output changes healthy existing code, changes the user's authored text, or introduces a conflicting definition. The borderline Sweep `dd06` remains conservatively labeled dangerous. Raw labels never change when a guard suppresses the response; the post-guard label is then abstain.

The ordinary tests replay fixtures only. Acquisition is opt-in and never starts a server:

```sh
bun docs/research/next-edit-spike/scripts/hardening-build.ts
POLARIS_PREDICTION_LIVE=1 bun docs/research/next-edit-spike/scripts/hardening-run.ts dev
POLARIS_PREDICTION_LIVE=1 bun docs/research/next-edit-spike/scripts/hardening-run.ts dev zeta-2.1
bun docs/research/next-edit-spike/scripts/hardening-review.ts dev
bun docs/research/next-edit-spike/scripts/hardening-review.ts dev zeta-2.1
```

Use `test` instead of `dev` only after freezing the guards. Acquisition refuses to overwrite recorded responses and requires the model's private loopback port (Sweep 8091, Zeta 8092). Keep previous artifacts when measuring another model/guard version. `mine.ts 2500 --json` emits complete candidate hunks for review; its default text view is abbreviated. `SPIKE_REPO` can select another checkout; the default is this checkout.

Each recorded duration covers prompt construction and production endpoint streaming, before offline parsing and guards. **Zeta was served from an external SSD: its durations are diagnostic records, not speed measurements.** They must not enter a latency comparison table. No model was downloaded; only the explicitly started private server PIDs were stopped. The shared port 8080 was not used.

The successful held-out runs used `POLARIS_EDIT_WARMUP=1`, which sends a separate one-token `hello` before the cases. That warmup has a startup-only allowance; evaluation requests retain the 120-second deadline. The metadata preserves the earlier failed Zeta acquisition.

## Hill-climb fixtures (2026-10-15)

- `fresh-cases.json`: the 56-case held-out set. It was mined by edit shape only and frozen before any experiment (sha256 `c5ecc7d6…f5bc9b`).
- `hillclimb-dev-base.json` and `hillclimb-dev-a10b20.json`: live Sweep outputs over the 100 hardening cases with the spike layout and with the final layout.
- `hillclimb-fresh-base.json` and `hillclimb-fresh-final.json`: the single held-out runs.
- `hillclimb-labels.json`: rubric labels of the shown states, keyed by case and by the sha256 prefix of the whitespace-stripped buffer.
- `hillclimb-corpus.json`: every labelled state from any run, as edits.

`docs/research/next-edit-spike/scripts/hc-fixtures.ts` regenerates all of these from `raw/hc/`; see the hill-climb section of `docs/research/next-edit-spike.md`.

## Diagnostics verifier fixtures (2026-10-15)

- `fresh2-cases.json`: the second held-out set (50 cases), mined by shape only from commits disjoint from both earlier sets. It was committed before any model saw it (built output sha256 `b3e1aed4…1d802`).
- `diagnostics.json`: the TypeScript server's errors for every case buffer and every labelled state (edits plus errors as offsets), and the case's importable unresolved names. The states cover the spike, hardening, hill-climb and both held-out sets.

`docs/research/next-edit-spike/scripts/dv-fixtures.ts` regenerates it from `dv-states.ts`, `dv-diagnose.ts` (with and without `DV_FIXES=1`); see "Diagnostics verifier, 2026-10-15" in `docs/research/next-edit-spike.md`.
