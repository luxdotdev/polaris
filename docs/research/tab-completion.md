# Tab completion: spike results (2026-10-13)

Follow-up to [completion-providers.md](completion-providers.md) (ENG-173). Scripts on branch `spike/tab-completion` (b62492a5). Owner decisions, 2026-10-13: v1 is ghost-text FIM; next edit in v1.1; the model server is reported as its own line, outside the 1 GB budget; placement is Auto plus a per-Host override; llama-server is recommended over Ollama.


M2 Max, 24 repo TS cursors, warm. A = first request in a file; B = next keystroke. Load average 6–58 (other agents). Details: `.dagr/evidence/tabspike/notes.md`, raw data alongside.

## 1. Latency, total ms (p50/p90)

| Model · server | A | B |
|---|---|---|
| Qwen2.5-Coder 1.5B · llama-server (Ollama) | 786/1095 (903/1700) | 493/683 |
| Sweep 1.5B · llama-server n-gram (Ollama) | 796/939 (2105/2989) | 585/825 |
| Zeta 2.1 Q4 · n-gram, frozen history (Ollama) | 3041/4259 (4595/5963) | 1627/2079 |
| **Mellum2 12B-A2.5B** · llama-server | 1192/1777 | **230**/603 |

- Ollama lacks n-gram speculation, so rewrite models are 2.5× slower on it.
- Mellum and Zeta are SPM (suffix first), which keeps the prompt cached: Mellum's B TTFT is 27 ms.
- Zeta needs its edit history snapshotted at pauses. Updated every keystroke, it busts the cache (88 vs 680 cached tokens).

## 2. Quality (hand-judged accept + partial, /24)

| | Excerpt | + definitions & import outlines |
|---|---|---|
| Mellum2 | 5+2 | **8+2** |
| Zeta 2.1 | 2+2 | 5+2 |
| Qwen 1.5B | 4+3 | 5+1 |
| Sweep | 3+2 | 3+1 |

- Most misses need project facts, so context matters.
- Next-edit output on typing cases was noise or abstention.

## 3. Models

- **Artificial Analysis** ranks chat ability, not FIM: its Coding Index wasn't readable, and the small-model ranks don't measure FIM.
- **Gemma 4** has no FIM tokens; E4B, chat-prompted, scored 1/24.
- **Qwen3.5-4B**: 1/24.

| Tier | Model (all Apache-2.0) | RSS |
|---|---|---|
| Small, 8 GB | Qwen2.5-Coder-1.5B | 1.4 GB |
| **Medium, 16 GB+** | Mellum2-12B-A2.5B IQ4 | 6.2 GB |
| Large, 32 GB+ | Qwen3-Coder-30B-A3B (unmeasured) | ~18 GB |
| Next-edit, opt-in | Zeta 2.1 / Sweep | 6 / 2 GB |

## 4. CodeMirror 6

- **Ghost text**: a StateField holding an inline widget plus a block widget for further lines.
- **Keys**: a Prec.highest keymap above vim.
  - Tab accepts only when no popup or snippet field is active, else falls to `indentWithTab`.
  - ⌥→/Ctrl→ accepts a word; Esc dismisses.
- **LSP popup open**: hide the ghost; Enter stays the popup's.
- **Next edit**: a target-line chip, then an inline diff via editor-inline's `hunksOf`.
- **Imports**: auto-import via the completion item's `additionalTextEdits`.
- **Libraries**: build our own (~400 lines). `@marimo-team/codemirror-ai` (Apache, active) is the reference; `codemirror-copilot` (MIT) has been stale since 2024.

## 5. Architecture

- **Placement**: the Client decides. It compares both sides' reports (chip/GPU, RAM, load, reachable endpoint and models) and a rolling p50 latency, falling back to the other side, then off.
- **SSH**: 15–40 ms to lucas-rpi on an open session, which is negligible. A Pi 4 is never chosen.
- **Context**: assembled on the Host (files, LSP), stable pieces first. Before Trust, no LSP.
- **Budget** (~2k tokens, Seed-Coder tokens):

  | Piece | Cost |
  |---|---|
  | Definitions | 194 |
  | Import outlines | ~700 |
  | Excerpt ±30 lines | 526 |
  | Edit hunks | 590 |
  | Diagnostics | 93 |
  | Open-buffer heads (low value) | 1346 |

- **Requests**: one per keystroke, the previous one aborted.
- **Memory**: a user-run model server (1.4–7 GB) is outside the budgets.ts trees; report it as its own line.

## 6. Delivery

- **v1**: a user-run endpoint. Ollama via `/api/generate` with `raw`; LM Studio and llama-server via `/v1/completions`.
- **Later**: a managed llama-server plus GGUF pinned by SHA-256, as the language catalog does.

## Recommended v1

Ghost-text FIM: Mellum2 on 16 GB+, Qwen 1.5B below that, on the stronger machine, with definitions and outlines as context. Next edit behind a setting.

| Package | Size |
|---|---|
| Protocol `prediction.*` stream + capability | S |
| Shared predictor (formats, client, budget, cancel) | M |
| Host context assembler | L |
| Placement/fallback | M |
| CM6 extension | M |
| Settings/status, bench | S |

## Owner decisions

1. Next edit in v1? Recommend v1.1.
2. Count the model server in the 1 GB budget? Recommend no, a separate line.
3. Placement override? Recommend Auto plus a per-Host setting.
4. Recommend llama-server over Ollama for next-edit models? Recommend yes.

## Downloads

Kept: Mellum2 IQ4_XS 6.73 GB (winner), Sweep Q8 1.54 GB, llama.cpp 20 MB. Removed: Zeta 2.1 5.07, Gemma 4 E4B 4.59, Qwen3.5-4B 2.71, Qwen2.5-Coder-1.5B 0.99 GB.
