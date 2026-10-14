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
