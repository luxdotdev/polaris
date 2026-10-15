# Next-edit spike: local region-rewrite models (2026-10-14)

Measurements for tab autocomplete v1.1 (next-edit prediction). This follows [tab-completion.md](tab-completion.md) and [completion-providers.md](completion-providers.md). The v1 FIM path is [packages/predict](../../packages/predict/README.md). Scripts, cases and raw outputs are in [next-edit-spike/](next-edit-spike/) on branch `spike/next-edit`. This doc reports measurements; the decisions belong to the owner.

**Setup.** M2 Max with 32 GB, llama.cpp b11429 (`llama-server` from Homebrew). One server ran at a time on 127.0.0.1:8091–8093, with `-c 8192 -np 1 -ngl 99 --cache-reuse 256` and `cache_prompt: true`. Decoding was greedy. The shared Mellum2 server on :8080 was not touched. Other agents kept the load average between 2 and 17, so latency carries roughly ±15% noise.

## Candidates

| Model | GGUF | Status |
|---|---|---|
| Zeta 2.1 (Seed-Coder-8B base) | `mradermacher/zeta-2.1-GGUF` Q4_K_M, 5.07 GB, sha256 `f031e71d…` (community quant; Zed publishes only safetensors) | Measured |
| Zeta 2.1 Q8_0 | Same repo, 8.77 GB | **Not measured.** The disk had 9.9 GiB free, so the download would have left about 1 GiB on a machine other agents share. I aborted it. |
| Sweep Next-Edit 1.5B | Official `sweep-next-edit-1.5b.q8_0.v2.gguf`, 1.54 GB, sha256 `1321ea5e…`, reused from the existing Ollama blob | Measured |
| Mellum2 12B-A2.5B IQ4_XS (FIM baseline) | The same blob as the shared server, run in my own server on :8092 | Measured on insertion cases only |

## Prompt formats and their sources (Zed source not read)

- **Zeta 2.1.** From the [model card](https://huggingface.co/zed-industries/zeta-2.1) README plus `sample.prompt` and `sample.output` (Apache-2.0).
  - Layout: `<[fim-suffix]>\n<[fim-prefix]><filename>edit_history\n{unified diffs}\n\n<filename>{path}\n{40 lines before}<|marker_1|>{region 1}\n<|marker_2|>{region 2}<|marker_3|>\n<[fim-middle]>`.
  - I copied the geometry from the sample: two regions of about 15 lines each, with the cursor `<|user_cursor|>` about 2 lines above `marker_2`, and an empty suffix.
  - The README's minimal example puts the code after the region in the suffix, but the real sample leaves the suffix empty. I followed the sample.
  - The model returns one region (`<|marker_1|>…\n<|marker_2|>`). It also returned `<|marker_1|><|marker_1|>` (24 of 150 responses). The card doesn't document that output; I read it as "no edit".
- **Sweep.** From the card's [`run_model.py`](https://huggingface.co/sweepai/sweep-next-edit-1.5B/blob/main/run_model.py) and the [blog post](https://blog.sweep.dev/posts/oss-next-edit). The blog's domain didn't resolve, so I read the Wayback snapshot `20260806152854`.
  - Layout: `<|file_sep|>{path}` with the 80 lines above the window, then one `<|file_sep|>{path}.diff` block per earlier edit (`original:`/`updated:` with 1 line of context), then `original/{path}` (the window before the most recent change), `current/{path}` (the window now) and `updated/{path}`.
  - The window is fixed at 21 lines: 10 above the cursor, the cursor line, and 10 below (from the blog). The model rewrites the whole window.
  - A sanity run of `run_model.py`'s own example produced the card's intended edit (adds the time-of-day greeting).
- **Mellum2 FIM.** `@polaris/predict`'s `buildPrompt` (`mellum-spm`), `generationBudget` and `postprocess`, unchanged. The edit history is passed as `editHunk` context.

## Workload

[30 cases](next-edit-spike/scripts/cases.json) mined from this repo's last 1,085 commits. All are TypeScript or TSX ([mine.ts](next-edit-spike/scripts/mine.ts), then hand-picked).

- **Shape.** Each case is one file in one commit. 1–4 hunks are applied as the edit history, and the next hunk is the ground truth.
- **Categories.** Rename propagation 7, continue a refactor 6, delete dead code 6, add a missing import 6, insertion 5.
- **Insertion cases.** These are FIM-like: about 40% of the target's first line is already typed.
- **Keystrokes.** Each case is 5 requests. The user finishes typing the last edit, 1–3 characters per keystroke. Step 0 is the first request in the file ("cold"), steps 1–4 are warm, and step 4 (the complete state) is the one scored.
- **Exact.** A prediction counts as exact when the whitespace-insensitive file equals current + target, optionally plus other hunks from the same commit. This is Sweep's own metric.
- **Hand labels.** I labelled every other output in [judgement.json](next-edit-spike/raw/judgement.json):
  - *acceptable*: I would press Tab.
  - *wrong*: rejected, but leaves existing code alone.
  - *dangerous*: deletes or rewrites healthy code, reverts the user's recent edit, or adds a conflicting definition.
- **Out of window.** Some targets fall outside the rewritable window: 7 of 30 for Zeta's geometry and 13 of 30 for Sweep's. Neither format can reach those without a jump, so there the only correct output is no edit.

## 1. Latency (server time = prompt + generation, ms)

| Run | Warm p50 / p90 | Cold prompt (tokens) | Warm prompt tokens | Output tokens | tok/s | Draft accepted | RSS |
|---|---|---|---|---|---|---|---|
| Sweep, no speculation | 1190 / 1857 | 298 (820) | 89 | 181 | 158 | – | 2.6 GiB |
| **Sweep + n-gram** | **256 / 426** | 296 (820) | 89 | 181 | 827 | 75% | 2.6 GiB |
| Sweep + n-gram, card-sized prompt (~20 KB of sibling files) | 343 / 551 | 2678 (5943) | 89 | 177 | 610 | 73% | 4.8 GiB |
| Zeta Q4, no speculation, frozen history | 3593 / 4928 | 1526 (757) | 150 | 175 | 52 | – | 6.8–8.7 GiB |
| **Zeta Q4 + n-gram, frozen history** | **1510 / 2228** | 1526 (757) | 150 | 175 | 139 | 62% | 6.8–8.7 GiB |
| Zeta Q4 + n-gram, live history (the card's sample) | 2154 / 3265 | 1526 (757) | 599 | 175 | 140 | 62% | 6.8–8.7 GiB |
| Mellum2 FIM, v1 `buildPrompt` at a 2048 budget | 415 / 438 | 475 (597) | 517 | 5 | 116 | – | 7.2–7.7 GiB* |
| Mellum2 FIM, budget 16384 (prefix never trimmed) | **70 / 98** | 629 (827) | 5 | 5 | 115 | – | 7.6 GiB* |

\* The weights are mmapped from the same file as the shared server, so the RSS counts pages both processes share.

- **Speculation.** All runs used `--spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48`. The n-gram lookup drafts from the prompt, so the original region serves as the draft.
  - It produced the same outputs as no speculation in 149/150 and 150/150 requests.
  - Tuned on 8 cases ([tune.py](next-edit-spike/scripts/tune.py)). Sweep, warm p50 in ms:

    | Spec type (n/m) | Warm p50 |
    |---|---|
    | ngram-simple 8/48 | 255 |
    | ngram-simple 12/48 (default) | 270 |
    | ngram-mod | 315 |
    | ngram-map-k | 1060 |
    | ngram-cache | 1160 |
    | none | 1194 |

  - Zeta, warm p50 in ms:

    | Spec type (n/m) | Warm p50 |
    |---|---|
    | ngram-simple 8/48 | 1542 |
    | ngram-mod | 1628 |
    | ngram-simple 4/16 | 2022 |
    | none | 3857 |
- **Draft-model speculation.**
  - Zeta has no smaller Seed-Coder model to draft with.
  - For Sweep it isn't needed, since n-gram lookup is available. Not run.
- **Where the time goes.** Both rewrite formats emit about 175–180 tokens per request, whatever the edit's size: the whole region or window.
  - Zeta's "no edit" marker answer is the exception: its warm p50 is 589 ms, almost all prompt time.
  - Zeta Q4 processes prompts at about 2 ms/token (≈500 tok/s); Sweep at ≈2,800 tok/s.
- **Zeta history.** Rebuilding the edit history on every keystroke re-processes about 600 tokens per request (2154 vs 1510 ms). Snapshotting it at the burst's first keystroke keeps the prefix cached.
- **v1 FIM caching.** `fitText` trims the prefix from the front against a byte budget, so the prompt start moves on every keystroke. Each request then re-processes the whole prefix: 517 tokens, 415 ms. An untrimmed prefix gives 70 ms. This is a v1 finding as well.

## 2. Quality (scored keystroke, /30)

| Run | Exact | Acceptable | Wrong | Dangerous | Abstain | In window: exact or acceptable | Out of window: dangerous |
|---|---|---|---|---|---|---|---|
| Sweep (with and without speculation) | 6 | 0 | 2 | **7** | 15 | 6/17 | 3/13 |
| Sweep, card-sized prompt | 6 | 0 | 2 | **10** | 12 | 6/17 | 5/13 |
| Sweep, most recent edit also as a `.diff` (experiment) | 6 | 0 | 2 | 8 | 14 | 6/17 | 4/13 |
| **Zeta Q4** (frozen or live history, with or without speculation) | **9** | 0 | 4 | 1 | 16 | 9/23 | **0/7** |
| Mellum2 FIM (insertion cases only, /5) | 3 | 1 | 1 | 0 | 0 | 4/5 | – |

Exact predictions by category (the number of cases in each category is in the column header):

| Category (cases) | Sweep | Zeta Q4 |
|---|---|---|
| Rename (7) | 1 | 1 |
| Refactor (6) | 2 | 2 |
| Dead code (6) | 0 | 3 |
| Import (6) | 0 | 0 |
| Insertion (5) | 3 | 3 |

- **Sweep's dangerous outputs.** 6 of the 7 revert the user's most recent edit. In 4 of those 6, the new code referenced a name not yet imported or defined, and Sweep restored the old code: `which`, `VERSION`, `Predicate`, `acceptable`. All examples are in the `*.review.md` files.
  - The automatic revert check (old lines from the history reappear) flagged all 6 reverts and none of the exact outputs.
  - Adding about 6k tokens of related files didn't help: 10 dangerous instead of 7, the same 6 exact.
- **Zeta's dangerous output.** One (in01): it also rewrote a healthy `};` to `});`. Zeta abstained on all 7 targets outside its window.
  - Zeta did delete `const mac` correctly in dd03 at step 0, then abstained on the same case 4 keystrokes later. Its output isn't stable across keystrokes.
- **Imports.** No model produced the import line (0/6). Zeta wrote a local stub once; Sweep reverted the use instead.
- **Insertion.** All three models scored 3/5 exact. Mellum was at 70 ms, Sweep at 256 ms and Zeta at 1.5 s.

## 3. From model output to insert, replace or delete

| | Zeta 2.1 | Sweep 1.5B | Mellum2 FIM |
|---|---|---|---|
| Output | Only the changed region(s), each rewritten in full (~15 lines) | The whole 21-line window, always | Text to insert at the cursor |
| No edit | `<|marker_N|><|marker_N|>` (fast), or the region echoed unchanged | The window echoed unchanged (full cost) | Empty after `postprocess` |
| Extra signal | `<|user_cursor|>` in the output gives the cursor position after acceptance | None | None |

What the client has to do for each:

- **Zeta.** Map the marker numbers back to the line ranges it sent, then diff each returned region against the original. Do a line diff, then a character diff inside changed lines, to get insert, replace and delete hunks. Strip `<|user_cursor|>` and keep it as the post-accept cursor.
- **Sweep.** Diff the whole window. The window is clipped at the file's edges. There is no explicit abstain, so the client compares the output with the window it sent.
- **Mellum2.** v1 already handles this as ghost text. `@polaris/syntax-diff`'s token alignment fits the diff step for both rewrite formats.
- **Common to both rewrite formats.** Latency scales with region size rather than edit size, so a smaller region is cheaper.
  - Region-level output still needs a guard against edits outside the hunk the user would expect.
  - In this data, the revert check caught 6 of the 7 dangerous Sweep outputs.

## Recommendation (facts for the owner's decision)

- **Under 250 ms p50 server time.**
  - No next-edit configuration reached it strictly. **Sweep 1.5B Q8 + n-gram** came closest: 256 ms p50, 426 ms p90, 2.6 GiB, with ≈820-token prompts. Without n-gram it took 1190 ms. With card-sized ≈6k-token prompts it took 343 ms warm and 2.7 s cold.
  - Mellum2 FIM, for insertion only, reaches 70 ms, but only when the prefix isn't front-trimmed. The v1 `buildPrompt` budget gives 415 ms.
- **16 GB Macs.**
  - Sweep is the only next-edit model whose latency is near the target. Its footprint is 2.6–4.8 GiB.
  - Its quality is the weaker of the two: 6/30 exact and 7–10 dangerous edits, most of them reverts. In this data, a client-side revert guard would have removed 6 of the 7.
  - Zeta Q4 needs 6.8–8.7 GiB on top of the app and is 1.5 s warm.
  - Not measured here: a 16 GB base-chip Mac has about a quarter of the M2 Max's memory bandwidth, so expect slower decoding.
- **32 GB+ Macs.**
  - Zeta 2.1 Q4 + n-gram has the best quality: 9/30 exact, 1 dangerous, 0 out-of-window noise.
  - At 1.5 s warm p50 it only works as a slower, at-pause next-edit suggestion, not a per-keystroke one. It needs the history snapshot. Q8 was not measured, for lack of disk space.
- **What doesn't work.**
  - Zeta without speculation: 3.6 s.
  - Zeta with per-keystroke history: 2.2 s.
  - Rewrite models for add-import: 0/6.
  - Any cursor-centred window for targets more than ~10–15 lines away, which needs a jump step.
  - Sweep without a revert guard.
  - The v1 prefix trimming, which defeats the prompt cache.

## Reproduce

```sh
cd docs/research/next-edit-spike/scripts
bun run.ts <tag> <zeta-frozen|zeta|sweep|sweep-related|mellum-frozen-16k|…> <gguf> [llama-server args]   # port $SPIKE_PORT (8091)
bun score.ts <tag…>                                    # latency table + raw/<tag>.labels.json + review.md
python3 table.py ../raw <tag>=<judgement key> …        # quality table with hand labels
```

Models live in `~/.cache/next-edit-spike/models`; the Zeta Q4 GGUF was deleted after its runs. `matrix-a.sh` and `matrix-b.sh` hold the exact run order.

## Live hardening, 2026-10-15

**Workload and split.** [The manifest](next-edit-spike/scripts/cases.json) now contains 100 Polaris-history cases: rename 21, refactor 20, dead-code deletion 20, import 20, insertion 19. The original 30 are dev cases; 70 additional cases were selected by hunk shape and reviewed before inference, 14 per category. New cases apply all non-target hunks as frozen history; insertion cases then type 40% of the target's first line. The miner can emit complete candidate hunks with `--json`. No external source code was copied.

The split was fixed before querying either model: 70 dev and 30 held-out, with six held-out cases in each category. Within each category, the new cases were sorted by SHA-256 of `ep1b:<commit>`; the first eight went to dev and the last six to test. No source commit crosses splits; some file paths do. This is a selected TypeScript/TSX workload, not a random sample. Full target patches fit Sweep's window in 32/70 dev and 8/30 test cases, and Zeta's window in 40/70 dev and 9/30 test cases. Most held-out targets therefore require a jump before the model can reach them.

**Method.** Each model received one request for each frozen final state, using the production prompt builder and streaming endpoint decoder, then the production parser, diff and guards. There were no five-keystroke sequences in this run. Both servers used context 8192, one slot, 99 GPU layers, cache reuse 256, `ngram-simple` with n=8/m=48, greedy sampling, prompt caching, and a 512-token output cap. Sweep used the existing Q8 blob on private port 8091; Zeta 2.1 Q4_K_M used the owner-provided external-SSD GGUF on private port 8092. Only one of these servers ran at a time. No downloads or shared-port-8080 requests occurred. All three private server instances were stopped by their recorded PIDs.

The Host was an Apple M2 Max with 32 GiB RAM, Bun 1.3.13 and llama.cpp 0.6.0 (build 11429, `d81235049`). It was busy: load averages recorded after the runs were 72.18 / 121.92 / 68.71. Zeta initially needed about five minutes to become ready. Its first held-out request produced no completed response before the unchanged 120-second deadline; that acquisition failure is recorded separately. A one-token non-evaluation warmup preceded each successful held-out acquisition. No held-out response was reviewed before the guard sources were frozen, and those sources were unchanged afterward. [Metadata](../../packages/predict/src/edit/fixtures/hardening.meta.json) records the hashes, settings and failure.

All 200 completed responses and their labels are committed under [the replay fixtures](../../packages/predict/src/edit/fixtures/README.md). Exact and abstain use the spike's whitespace-insensitive rule; every other response was reviewed against its history and target. Acceptable includes correct partial insertion continuations. Sweep `dd06` is borderline and remains conservatively labeled dangerous. Labels describe raw output; suppression changes the shown result to abstain without relabeling the raw response.

| Model | Set | Stage | Exact | Acceptable | Wrong | Dangerous | Abstain |
|---|---|---|---:|---:|---:|---:|---:|
| Sweep Next-Edit 1.5B Q8 | Dev, 70 | Raw | 10 | 0 | 6 | 13 | 41 |
| Sweep Next-Edit 1.5B Q8 | Dev, 70 | After guards | 10 | 0 | 6 | 0 | 54 |
| Sweep Next-Edit 1.5B Q8 | Held-out, 30 | Raw | 3 | 1 | 3 | 3 | 20 |
| Sweep Next-Edit 1.5B Q8 | Held-out, 30 | After guards | 3 | 1 | 0 | 0 | 26 |
| Zeta 2.1 Q4_K_M | Dev, 70 | Raw | 13 | 3 | 8 | 2 | 44 |
| Zeta 2.1 Q4_K_M | Dev, 70 | After guards | 13 | 3 | 8 | 0 | 46 |
| Zeta 2.1 Q4_K_M | Held-out, 30 | Raw | 3 | 1 | 3 | 0 | 23 |
| Zeta 2.1 Q4_K_M | Held-out, 30 | After guards | 3 | 1 | 1 | 0 | 25 |

No exact or acceptable response was suppressed on either split or model. Dangerous-after-guards cases and hunks: **Sweep dev `[]`, Sweep held-out `[]`, Zeta dev `[]`, Zeta held-out `[]`**. Sweep's held-out dangerous cases were `hrn14` (changes the newly written version lookup), `hin12` (deletes healthy eligibility checks), and `hrf13` (rewrites the user's `input.models` call in the wrong function); each produced no shown hunks. [The review](next-edit-spike/raw/live-hardening.review.md) records every non-exact/non-abstaining decision and each dangerous raw patch with its post-guard hunks. [Machine-readable counts](../../packages/predict/src/edit/fixtures/hardening-summary.json) preserve both stages. Zeta's held-out raw responses contained no dangerous example, so that split does not measure its guard's sensitivity to a new dangerous output. Zeta `hin12`, a wrong new branch, remained visible.

**Measured restraint.** The dev-driven checks protect authored history lines except pure cursor continuations, closing punctuation including backticks, delimiter balance, existing definitions, imported bindings, and identifier propagation. Mixed edits may remove complete blank lines: Zeta `rf02` is exact under the spike rule and includes one such deletion. The checks are lexical and do not resolve scopes or types. The declaration check also suppressed wrong completions of unfinished names in `hin13`/`hin14`; this corpus does not establish retention of correct completions of such names. The measurements above establish retention and suppression on this corpus; the many abstentions and out-of-window targets limit generalization.

**Runtime cost.** The existing `packages/predict/src/edit/bench.ts` was run for three rounds before and after the change, on the same original 60-response replay workload with in-memory HTTP and no model server. Replay pipeline p50 was 0.298 / 0.241 / 0.186 ms before and 0.332 / 0.251 / 0.194 ms after; p95 was 0.953 / 0.607 / 0.396 ms before and 2.198 / 1.177 / 0.838 ms after. The added scans increased tail cost in these runs; these are busy-Host observations, not a quiet-Host performance gate. FIM prompt p50 stayed within 0.149–0.164 ms across both measurements. No baseline or timeout was relaxed.

Zeta's per-request durations are retained only in its raw fixtures. **They include external-drive behavior and are not speed measurements; no Zeta model latency is included in a latency table.** Ordinary tests use fixtures only; the live acquisition and 100-case harness remain opt-in.

**Verification.** Affected-package typecheck passed; the predictor suite passed 322 tests with two opt-in live tests skipped and zero failures. The 200 new model-response replays plus four coverage checks all passed. Root format/lint and license checks passed (680 production dependencies plus eight platform builds, zero license violations).

## Hill-climbing Sweep, 2026-10-15

**Goal and protocol.** Raise useful (exact + acceptable) Sweep Next-Edit 1.5B Q8 predictions without showing a dangerous edit after guards; abstaining is fine. Before any experiment, a fresh held-out set of 56 cases was mined by edit shape only ([`mine-fresh.ts`](next-edit-spike/scripts/mine-fresh.ts)) and frozen as [`fresh-cases.json`](../../packages/predict/src/edit/fixtures/fresh-cases.json), sha256 `c5ecc7d6…f5bc9b`. It holds rename 8, refactor 12, dead-code 12, import 12 and insertion 12, from commits disjoint from the other 100 cases, with each target within 40 lines of the cursor. The harness refuses to load that set without `HC_FINAL=1`. Every experiment ran live on the 100 hardening cases (dev for this work). Each shown state that was new got a rubric label in [`labels.json`](next-edit-spike/raw/hc/labels.json). A change was kept only if useful rose (or wrong fell), dangerous-after-guards stayed 0, and no useful case was lost. At the end, the fresh set ran once with the baseline and once with the final config.

**Setup.** A private llama-server on 127.0.0.1:8091 used the Q8 blob with greedy decoding. Its outputs were deterministic: a rerun of the baseline reproduced the hardening recordings byte for byte. The Host was busy (load 9–14 on the M2 Max), so p50 is the server-plus-pipeline time per request, noisy, and recorded but not optimised. Runs, labels and per-run review files are in [`raw/hc`](next-edit-spike/raw/hc/); the scripts are `hc-run.ts`, `hc-score.ts`, `hc-label.ts`, `hc-table.ts`, `hc-stability.ts` and `hc-fixtures.ts`.

### Experiment log (dev, 100 cases)

"Spike guards" are the guards shipped by the hardening work. "+ new" adds the nearest-change fallback and the seven guards below. Lost means useful in the baseline, not useful here.

| Id | Change | Guards | Useful | Wrong | Dangerous | Abstain | p50 ms | Lost | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| E0 | Spike layout: 10/10 window, 80-line prefix, history `.diff` without context | spike | 14 | 6 | 0 | 80 | 758 | – | baseline |
| E1 | + nearest-change fallback | spike | 16 | 6 | 0 | 78 | 758 | – | **kept** |
| E2 | Model-card history (1 context line, no last `.diff`) | spike | 14 | 6 | 0 | 80 | 609 | hin01 hrf04 hrf11 | rejected |
| E3 | 1 context line around each history hunk | spike | 14 | 7 | 3 | 76 | 525 | hin01 | rejected |
| E4 | No `.diff` block for the last hunk | spike | 14 | 7 | 0 | 79 | 365 | hin01 hrf11 | rejected |
| E5 | 15-line window (7/7) | + new | 17 | 7 | 0 | 76 | 350 | rf04 | rejected |
| E6 | 25-line window (12/12) | + new | 17 | 7 | 0 | 76 | 485 | – | superseded by E10 |
| E7 | 31-line window (15/15) | + new | 19 | 7 | 0 | 74 | 513 | hrf04 | rejected |
| E8 | 41-line window (20/20) | + new | 20 | 7 | 1 | 71 | 647 | hin11 hrf04 | rejected |
| E9 | 20 above / 10 below | + new | 17 | 6 | 1 | 76 | 494 | hin11 hrf04 | rejected |
| **E10** | **10 above / 20 below** | + new | **20** | 7 | **0** | 73 | 552 | – | **kept** |
| E11 | 5 above / 20 below | + new | 18 | 8 | 1 | 73 | 507 | hdd06 hrf04 | rejected |
| E12 | 15 above / 20 below | + new | 21 | 7 | 1 | 71 | 602 | hdd06 hrf04 | rejected |
| E13 | 10 above / 30 below | + new | 20 | 8 | 0 | 72 | 614 | – | rejected (no gain) |
| E14 | 10 above / 15 below | + new | 17 | 8 | 0 | 75 | 482 | – | rejected |
| E15 | E10 + 40-line prefix | + new | 21 | 6 | 1 (hrf07) | 72 | 605 | – | rejected |
| E16 | E10 + 160-line prefix | + new | 19 | 8 | 1 | 72 | 789 | rn02 | rejected |
| E17 | E10 + 1 context line | + new | 19 | 8 | 1 | 71 | 701 | hdd06 hin01 | rejected |
| E18 | E10 + model-card history | + new | 16 | 8 | 0 | 76 | 317 | hdd06 hin01 rn01 rn06 | rejected |
| E19 | E10 + the file's import block before the prefix | + new | 20 | 7 | 1 | 72 | 627 | – | rejected |
| E20 | E10 + only the last 2 history hunks | + new | 20 | 7 | 0 | 73 | 278 | – | rejected (tie) |
| E21 | E10 + abstain unless a T=0.5 sample agrees | + new | 20→19 | 7→6 | 0 | – | ×2 cost | hin01 | rejected |
| E22 | E10 + abstain unless the previous keystroke's prediction agrees (93 states) | + new | 20→15 | 7→5 | 0 | – | ×2 cost | hrf11 hrf06 rn01 rn05 hin01 | rejected |

Rows E5–E20 are scored with all new guards, as kept by the guard experiments below. Without them, the same raw outputs show 1–8 dangerous edits (E8: 8, E12: 5, E6: 2); E10 shows none either way. E21 and E22 were scored offline from a second live run. E20 equals E10 on every measure except speed, so the keep-rule rejects it; it is the cheapest lever if latency matters later.

**Guard experiments.** Each candidate was scored on every labelled state any run produced (126 states) and on the 100 dev ground-truth patches:

| Guard (`EditOptions` flag) | Suppresses | Kept? |
|---|---|---|
| `novelNames` | an edit using a code identifier that the buffer, history and path never mention (keywords, globals and completions of the typed word excepted), or a duplicate import | kept: catches 7 dangerous and 4 wrong, 0 useful; blocks 3/100 dev truths (`im01`, `hin06`, `hrf09`) |
| `declarationRenames` | renaming an existing declaration other than the one being typed (`rf06`, `hrn09`) | kept |
| `removedNames` | re-adding, away from the cursor line, a name the history removed | kept |
| `deletionEvidence` | a pure whole-line deletion with no evidence in the history (a removed name, a moved line, a newly imported name) | kept: 0 dev truth cost |
| `relevance` | a change group more than one line from the focus touching no word of the history | kept: 0 dev truth cost |
| `duplicates` | a new line repeating its neighbour, or a name redeclared within two lines | kept |
| `selfReference` | a new `const x = f(x)` (`hdd07`'s `const { uuid } = send(…, uuid)`, `rateLimit(…)`) | kept: 0 truth cost |
| re-adds anywhere, drops untouched names, swaps, redeclare within 10 lines | – | rejected: cost exact outputs or 27 truths |

The nearest-change fallback applies to Sweep only. If the guards suppress the whole rewrite, it shows the change group nearest the focus, provided that group shares a name with the history and passes every guard by itself. The guards also apply to Zeta: on its 100 recorded hardening outputs they suppress one more wrong output and nothing else.

### Final config

`editOptions` in [`options.ts`](../../packages/predict/src/edit/options.ts) is now the default: Sweep window 10 above and 20 below the focus line, 80-line prefix, history `.diff` blocks without context including the last hunk, at most 32 hunks, the nearest-change fallback, and all seven guards on. The old layout stays available as `spikeEditOptions`, and the earlier hardening and replay recordings pin it. The Desktop App already requests 2048 output tokens, so the 31-line window fits.

[`hillclimb.test.ts`](../../packages/predict/src/edit/hillclimb.test.ts) replays the frozen runs ([fixtures](../../packages/predict/src/edit/fixtures/)). On dev, every shown state is reviewed, nothing dangerous is shown, no useful case of the spike layout is lost, and useful rises. Turning off the fallback, or any one guard, fails a test, because each guard alone suppresses at least one labelled dangerous state.

### Baseline vs final on the fresh held-out set (56 cases, one run each)

| Config | Exact | Acceptable | **Useful** | Wrong | **Dangerous** | Abstain | p50 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline (spike layout and guards) | 6 | 3 | **9** | 9 | **2** (`frf01`, `fim12`) | 36 | 558 |
| Final (`editOptions`) | 6 | 2 | **8** | 6 | **1** (`fdd09`) | 41 | 640 |

The dev gain did not carry over. On the held-out set, useful fell by one (lost `fin06` and `fdd08`, gained `frf04`), wrong fell from 9 to 6, and dangerous fell from 2 to 1 but did not reach 0.

The breakdown below rescores the recorded outputs after the fact; none of it was used to choose the config.
- **Window alone.** Final outputs with the spike guards score 9 useful, 8 wrong, 2 dangerous.
- **Guards alone.** Baseline outputs with the new guards and fallback score 8 useful, 6 wrong, 1 dangerous.
- So on held-out data, the window was roughly neutral, and the guards traded one exact for three wrong and one dangerous.
- **`fdd08`** is a correct deletion that `deletionEvidence` suppressed. The history re-wrote the deleted check in a different form, which the guard's "moved line" evidence does not recognise. [`hillclimb.test.ts`](../../packages/predict/src/edit/hillclimb.test.ts) records it as a `test.todo`.
- **`fdd09`** is the dangerous edit that got through. Instead of deleting a dead `turnsPlanned.push(key)`, Sweep rewrote it to push `{ key, shown: false }`. That silences the type error and records every turn twice. No guard covers "makes broken code compile wrongly".
- **`fin06`** in the final run added the right interface but also a stray unfinished comment line.

**Held-out truth audit.** Applied to the 56 fresh ground-truth patches, the new guards block 21, against 6 for the spike guards. On dev the figures were 20 and 17.
- `novelNames` blocks 8: six of the 12 insertion truths introduce a name the context never mentions, plus two refactors.
- `deletionEvidence` blocks 7 of the 12 correct dead-code deletions.
- `relevance` blocks 2.

Dev never showed this, because its dead-code and insertion cases happen to carry the evidence the guards ask for. Sweep rarely produces those truths today, so the measured cost on its outputs is one exact. Still, these two guards are tuned to the dev set and over-restrict. A better model would hit them more often.

**Runtime cost.** `bench.ts` measured the replay pipeline with in-memory HTTP and no model, three rounds each on a busy Host:
- p50 went from 0.33 / 0.19 / 0.19 ms with the spike options to 0.88 / 0.60 / 0.53 ms with the final ones.
- p95 went from 1.9 / 0.93 / 0.84 ms to 5.1 / 2.6 / 2.5 ms.
- The model's own p50 is about 550–650 ms.

**Caveats.**
- Labels are one reviewer's rubric judgements (the hardening rubric). Recurring calls: a local stub that shadows a needed import, and an unprompted rewrite of healthy code, are labelled dangerous.
- Fifty-six held-out cases is small: the useful difference of one case is noise. The direction of wrong and dangerous agrees with dev.
- Most targets still need a jump that a 31-line window cannot reach. Abstention stays above 70% on both sets.
- Wider windows expose new dangerous shapes, and the guards answer each one lexically. The held-out set shows this does not generalise cleanly.
- Next steps that the protocol forbade here, because they would tune on the held-out set:
  - recognise a modified move as deletion evidence;
  - restrict `novelNames` to edits away from the cursor line;
  - mine a new held-out set before keeping either change.

## Reach: jumps and imports, 2026-10-15

**Goal.** Most targets lie outside the window around the cursor. This section measures how far a jump probe (a second request with `focus` elsewhere in the file) and an import quick fix get Sweep to them, without showing more dangerous edits. The [protocol](next-edit-spike/reach/protocol.json) reuses the hardening split (70 dev, 30 held-out), Sweep Q8 on a private llama-server at 127.0.0.1:8093, greedy, production prompt, parser and guards. Labels follow the hardening rubric (exact / acceptable / wrong / dangerous / abstain) on the raw output; "shown" is after guards. Scripts are `reach-*.ts` and `imports-*.ts` under [`scripts`](next-edit-spike/scripts/); runs and labels are under [`reach`](next-edit-spike/reach/).

**Pre- and post-merge.** The work started on the spike layout (window 10 above / 10 below, hardening guards). Midway, the hill-climbed options (10 above / 20 below, seven guards) landed on main and were merged in. Every jump and chain number below is given for both; the pre-merge runs and labels are kept in [`reach/pre-merge`](next-edit-spike/reach/pre-merge/). Import numbers don't depend on the window or guards.

### Jumps

`reachFocuses` ([`reach/index.ts`](../../packages/predict/src/edit/reach/index.ts)) returns candidate focus offsets, best first, never two whose windows overlap. Signals, in tier order:
- **orphan**: a name the last edit removed that is now used once, at its declaration (dead code left behind).
- **moved**: a line or bound name the history added that still exists elsewhere (the copy left behind).
- **last**: names the last hunk removed entirely (§4's rule, restricted to the last hunk).
- **callee**: the definition of a call the last hunk added an argument to.
- **history**: names any earlier hunk removed.
- **signature** / **kept**: shared names in a changed signature, and names the last hunk kept. Measured, not on by default.

Within a tier, names used more than twice rank later, then the nearest line wins. Comments are ignored except inside backticks. §4's rule ("spec" below) is the baseline: names whose count fell in the last edit, nearest outside the window.

**Offline reach.** Cases whose target lies outside the cursor window, and how many the first probe brings into its window:

| Layout | Set | Outside | spec | default (`REACH_SIGNALS`) | all signals |
|---|---|---:|---:|---:|---:|
| Pre-merge (10/10) | Dev | 38 | 14 | 22 | 24 |
| Pre-merge (10/10) | Held-out | 22 | 5 | 11 | 11 |
| Post-merge (10/20) | Dev | 31 | 8 | 16 | 18 |
| Post-merge (10/20) | Held-out | 20 | 5 | 13 | 13 |

**Live, first probe only, shown after guards** (one request per case at the first focus; useful = exact + acceptable):

| Layout | Set | Policy | Probed | Useful | Wrong | **Dangerous** | Abstain | Raw dangerous |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Pre-merge | Dev | spec | 18 | 6 | 1 | **0** | 11 | 1 |
| Pre-merge | Dev | default | 24 | 9 | 1 | **0** | 14 | 1 |
| Pre-merge | Dev | all | 33 | 10 | 1 | **0** | 22 | 2 |
| Pre-merge | Held-out | spec | 14 | 0 | 0 | **2** | 12 | 7 |
| Pre-merge | Held-out | all | 21 | 1 | 4 | **3** | 13 | 6 |
| Post-merge | Dev | spec | 11 | 1 | 0 | **0** | 10 | 2 |
| Post-merge | Dev | default | 18 | 4 | 0 | **0** | 14 | 2 |
| Post-merge | Dev | all | 26 | 5 | 0 | **1** | 20 | 5 |
| Post-merge | Held-out | spec | 13 | 0 | 1 | **0** | 12 | 4 |
| Post-merge | Held-out | default | 16 | 1 | 4 | **1** | 10 | 5 |

On pre-merge held-out, default and all coincide on the first probe. Shown dangerous on held-out: pre-merge `hrn09` (renames a parameter and rewrites healthy messages; spec and all), `hdd12` (rewrites a healthy error message; spec), `hdd11` and `hrf14` (all); post-merge `hrf14` (replaces a healthy `div`'s classes with the new `PANE_CLASS`). Labels and notes: [`test.labels.json`](next-edit-spike/reach/test.labels.json), [`dev.labels.json`](next-edit-spike/reach/dev.labels.json).

**More probes don't pay.** Up to three sequential probes added no useful case on pre-merge dev (10 → 10) and showed up to four more dangerous edits (`rn01`, `rn02` ×2, `hrn06`, `hdd02`); post-merge default goes 4 → 4 useful with 0 → 1 dangerous. Ship one probe.

**Default signals.** Pre-merge, the policy frozen before held-out was all signals. After the merge, signature and kept added one useful case on dev (`hrf08`) and one shown dangerous (`hrf07`), which fails the keep rule, so the default dropped them. That choice was made on post-merge dev, but after the pre-merge held-out results had been seen; on those, signature and kept changed nothing at the first probe. Treat post-merge held-out as seen once already.

**What limits jumps is the model, not reach.** The first probe reaches about half the out-of-window targets, but Sweep turns few of them into a shown useful edit: post-merge dev 4 of 16 reached, held-out 1 of 13. Most probes abstain; wrong held-out probes edit the target line partially (`hrn11` sets the renamed field to the wrong value, `hrf09` drops one argument without adding the other, `hrf10` invents a promise type) or edit a nearby healthy line. The larger post-merge window helps the cursor request itself, which leaves fewer and harder targets for a probe.

### Chaining

How many of a multi-hunk file's later hunks a user reaches by pressing Tab: after each accepted hunk, the next request uses the new cursor window ("tab") or, if that misses, the first reach probe ("jump"). The oracle accepts the true next hunk whenever it lies in the window; live accepts only an exact shown prediction. "none" is the cursor window alone; "complete" counts files where every hunk was reached.

| Layout | Set | Files / later hunks | none | spec | reach (tab + jump) |
|---|---|---|---:|---:|---:|
| Pre-merge oracle | Dev | 57 / 148 | 32 (9) | 79 (26) | 90 (30; 52 + 38) |
| Pre-merge oracle | Held-out | 29 / 78 | 12 (4) | 22 (7) | 32 (11; 14 + 18) |
| Pre-merge live | Dev | 57 / 148 | | 17 (4) | 18 (5; 4 + 11) |
| Pre-merge live | Held-out | 29 / 78 | | 2 (1) | 3 (1) |
| Post-merge oracle | Dev | 57 / 148 | 49 (18) | 87 (32) | 89 (33; 68 + 21) |
| Post-merge oracle | Held-out | 29 / 78 | 29 (11) | 36 (13) | 44 (18; 31 + 13) |
| Post-merge live | Dev | 57 / 148 | | 18 (3) | 17 (3; 4 + 9) |
| Post-merge live | Held-out | 29 / 78 | | 2 (1) | 3 (1) |

Hunks reached (files complete). On held-out, reach adds 8 oracle hunks over spec post-merge (10 pre-merge); on dev, the wider window already reaches most of what reach added. The oracle shows reach could walk most multi-hunk refactors; live, Sweep breaks the chain at the first or second hunk. Live chaining is limited by prediction quality, not by where the next request looks.

### Imports

[`selectImportFix`](../../packages/predict/src/edit/imports/index.ts) picks one import quick fix for the burst's unresolved names (TS codes 2304, 2552, 2503, 18004), from the actions a language server returned. [`unresolvedInBurst`](../../packages/predict/src/edit/imports/index.ts) picks which diagnostics to ask about: those on a line the burst changed, or naming something the burst wrote.

It only accepts an action that inserts text into this file and whose title is an import (`Add import from`, `Update import from`). typescript-language-server attaches a `_typescript.applyCodeActionCommand` to every quick fix; it is accepted only when its `commands` list is empty (Schema-parsed), so it does nothing beyond the edit. The two rules:
- **spec** (§ spec): exactly one import action, or the one marked `isPreferred`.
- **module** (default): the preferred one; else the candidate whose module the file already imports from; else the one module that resolves every name in the burst; else, when one candidate is a bare package specifier and the others are relative paths into another package's `src`, the package.

**Method.** For each case, a temporary detached worktree at the case's commit (dependencies linked from this checkout, removed afterwards) held the post-history buffer. typescript-language-server 6.0.1 with tsserver 6.0.3, the versions Polaris manages, provided diagnostics and quick fixes. The chosen fix was applied and the server asked again, up to six rounds. "Right" means the same bindings from the same modules as the commit, placed differently; "partial" some of them.

| Set | Rule / scope | Exact | Right | Partial | Wrong | Nothing |
|---|---|---:|---:|---:|---:|---:|
| Dev, 14 | spec / changed lines | 4 | 6 | 0 | 0 | 4 |
| Dev, 14 | module / changed lines | 4 | 8 | 0 | 0 | 2 |
| Dev, 14 | module / lines + written names (default) | 4 | 9 | 0 | 0 | 1 |
| Dev, 14 | first server action | 4 | 9 | 0 | 1 | 0 |
| Held-out, 6 | spec / changed lines | 2 | 2 | 0 | 0 | 2 |
| Held-out, 6 | module / lines + written names (default) | 2 | 3 | 0 | 0 | 1 |
| Held-out, 6 | first server action | 3 | 3 | 0 | 0 | 0 |
| Extra, 16 | spec / changed lines | 4 | 8 | 0 | 0 | 4 |
| Extra, 16 | module / lines + written names (default) | 4 | 9 | 0 | 1 | 2 |
| Extra, 16 | first server action | 4 | 10 | 1 | 1 | 0 |

The rule and scope were frozen on dev (commit `68698a76`) before held-out and the extra cases ran. The extra cases ([`imports-mine.ts`](next-edit-spike/scripts/imports-mine.ts)) are 16 more add-import commits mined by shape after the dev tuning and never looked at before this run.

Findings:
- **The spec's "exactly one action" almost never holds.** tsserver always adds a declaration stub ("Add missing function declaration") next to the import. `isPreferred` covers most cases; the module rule covers most of the rest.
- **"Nothing" is the safe failure.** On dev `im04`, `which` comes from both `bun` and a local module; the commit used the local one. The first server action picks `bun`, which is wrong. The module rule offers nothing.
- **The module rule's one wrong import** is extra `xim12`: the file imports from `node:fs`, so the rule added `rm` there, but the commit wanted the promise `rm` from `node:fs/promises`. "Already imported from" is unsafe when a module and its `/promises` sibling export the same name; not fixed here, since the rule was frozen.
- **Scope.** Changed lines alone miss names the burst wrote that are used elsewhere (a re-export, a moved declaration: `him05`); adding written names fixes it without a wrong import.
- **For the Desktop App renderer:** its CodeActions payload schema (`apps/desktop/…/lsp/payloads.ts`) drops `isPreferred`, which the selector needs; it must also accept the no-op `_typescript.applyCodeActionCommand` instead of rejecting every action that carries a command.

### API

- `reachFocuses({ buffer, path, cursor, window, history })`: with `window` the last request's window. Probe only the first focus, once the cursor request shows nothing.
- `selectImportFix({ uri, text }, names, rule = "module")` with `unresolvedInBurst(diagnostics, burst)` and `UNRESOLVED_NAME_CODES`. Pure; the renderer brings the language server.

Tests use fixtures only: [`reach.test.ts`](../../packages/predict/src/edit/reach/reach.test.ts) checks the first probe reaches each dev case it reaches here, and [`imports.test.ts`](../../packages/predict/src/edit/imports/imports.test.ts) checks the selection rules on recorded action shapes.

**Caveats.** One reviewer's labels. Small sets: 20–31 out-of-window cases and 6 held-out import cases. The Host was busy, so no latency is reported; a probe is a second Sweep request (p50 about 550–650 ms).
