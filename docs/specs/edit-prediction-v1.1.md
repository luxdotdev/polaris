# Tab completion v1.1: Edit Predictions

Use this to build v1.1 of tab completion. Tab stops being "insert ghost text at the cursor" and becomes "accept the next Edit Prediction": an insertion, replacement, deletion, import or jump. v1's fill-in-the-middle (FIM) ghost text stays as the fallback when no next-edit model is available.

- **Terms:** `CONTEXT.md` (Edit Prediction, Editor, Host, Trust). Use them exactly; UI copy lowercases them.
- **Owner decisions (2026-10-14):** the region-rewrite model is the main source and the language server supplies imports; outcomes are logged locally; the restraint guards below are on by default; Full display is the default, with Subtle as a setting; jumps within the file are in v1.1; the model is picked by machine; **accuracy and correctness come before speed**. One model only (2026-10-15): no Mellum2 beside the next-edit model; about 16 GB for completion is too much.
- **Measurements:** `docs/research/next-edit-spike.md` (prompt formats, latency, the 30 labelled cases). v1: `packages/predict/README.md`, `apps/daemon/src/prediction/README.md`, DESIGN.md "Tab completion v1".
- **Wire contract:** `packages/protocol/src/editPrediction.ts` (`prediction.edit`). Not yet in `PredictionRpcs`; the Daemon slice adds it with its handler.
- **Not in v1.1:** edits in other files, a separate next-location model, training or fine-tuning on our data, running FIM and next-edit models side by side, latency targets as gates (measured and reported, not enforced).

## 1. Sources

| Kind | Source | Accept |
|---|---|---|
| Insert / replace / delete | Next-edit model through `prediction.edit` | Tab applies every hunk of the prediction as one undo step |
| Import | The file's language server: a quick fix for an unresolved name in code the user just wrote or accepted | Tab applies the server's edit through the existing proposal and edit fence (`lsp/editFence.ts`) |
| Jump | A prediction whose first hunk starts outside the visible cursor line ± 1, or a jump probe (§4) | First Tab moves the cursor to the hunk and shows it; the next Tab applies it |
| Insertion only (fallback) | v1 FIM, when no next-edit model is available on the machines placement can use | As v1 |

Only one source answers at a time. A next-edit model, when available, also handles plain insertion (the spike: 3/5 exact, the same as Mellum2).

## 2. Model, formats and placement

- **Formats** (`EditPredictionFormat`): `zeta-2.1` and `sweep-next-edit`, built from the spike's prompt layouts (§"Prompt formats" there; Zed's source is GPL and is not read).
  - Zeta: 40 lines of prefix, two ~15-line marked regions with the cursor ~2 lines above `marker_2`, an empty suffix. `<|marker_N|><|marker_N|>` and an echoed region both mean no edit. `<|user_cursor|>` in the output is the post-accept cursor.
  - Sweep: the 21-line window (10 above, cursor line, 10 below, clipped at the file's edges), each history hunk as a `.diff` block, then `original/`, `current/`, `updated/`. No abstain token; an echoed window is no edit.
- **Recognising models:** by model id on the endpoints placement already probes (`packages/client/src/prediction/score.ts`): `/zeta[\W_]*2[._-]?1/i` → `zeta-2.1`, `/sweep.*next[\W_]*edit/i` → `sweep-next-edit`.
- **Default model (owner, 2026-10-15; replaces Q6 c):** Sweep Next-Edit 1.5B on every machine. Zeta 2.1 is an opt-in "higher quality" choice in Settings, shown with its memory cost (6.8–8.7 GB vs 2.6 GB); held-out quality tied (4/30 useful each), Zeta led on the dev set (16 vs 10 of 70). Settings' Model list can override with any recognised model. No next-edit model → FIM as v1.
- **Placement** is v1's (`MainPredictionPlacement`, Client or Host side, Auto and the per-Host override). The Daemon serves `prediction.edit` lazily, like `prediction.complete`.
- **Polaris runs the model server (owner, 2026-10-15; reverses the v1 rule; ADR 0049).** The Daemon of the serving machine downloads the one chosen model and a pinned llama.cpp release (b11429) and runs llama-server on a loopback port of its own with the spike's flags (`-c 8192 -np 1 -ngl 99 --cache-reuse 256 --spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48`), started lazily and unloaded after 15 idle minutes. A model server of the user's own is still never started or stopped, and one already serving a next-edit model is preferred over downloading. `apps/daemon/src/prediction/managed/`.

## 3. The predictor (`packages/predict`)

`createEditPredictor(fetch).predict(request, { signal })` streams exactly one `Final` on success. It is pure TypeScript + Effect + web APIs, like v1.

1. **Window.** Compute the format's window around `focus ?? cursor`, in whole lines. `Final.window` reports it.
2. **Prompt.** Render history hunks in the format's diff, then the window. History is the request's, unchanged: the caller freezes it (§5).
3. **Generate.** OpenAI-compatible `/v1/completions` with `cache_prompt: true`, greedy, stop at the format's end marker; Ollama `/api/generate` raw. Reuse v1's endpoint, record decoder and limits.
4. **Diff.** Map the output back to the window's lines, then a line diff and a character diff inside changed lines, into minimal `PredictedEdit` hunks (offsets into the request buffer). Reuse `@polaris/syntax-diff`'s Myers if it fits; otherwise a small Myers in `packages/predict`.
5. **Guards that need only the request** (each dropped hunk goes into `suppressed`):
   - `revert`: a hunk that brings back lines the history removed or changed (the spike's check: caught all 6 Sweep reverts and no exact output). It also protects lines authored in the frozen history from nonliteral rewrites; a pure insertion at the cursor may continue the typed prefix. An accepted Edit Prediction is part of the history.
   - `outside-window`: any change outside the window.
   - `unstable`: whitespace-only changes to lines the model wasn't asked about, and a rewrite of a healthy closing line (the spike's in01 `};` → `});`) when the rest of the hunk is unrelated. It also rejects new delimiter imbalance, definition removal without history evidence, import-binding clashes, invented declaration renames, and propagation from an unrelated or unresolved identifier. Mixed edits may add or remove complete blank lines. These are conservative lexical checks, not scope or type resolution.
6. **Cursor.** Zeta's `<|user_cursor|>` becomes `Final.cursor` (in the post-edit buffer); otherwise the end of the last hunk.

**Correctness first:** the spike's raw outputs and hand labels (`docs/research/next-edit-spike/raw/*.jsonl`, `judgement.json`) become replay fixtures. A test feeds each recorded model output through steps 4–6 and asserts: every case labelled exact yields exactly the ground-truth hunks; every case labelled dangerous is suppressed or yields no edit; abstentions yield no edit. A live harness (`POLARIS_PREDICTION_LIVE=1`, never starting servers) runs the 100 frozen hardening cases end to end and prints exact / acceptable / wrong / dangerous / abstain, with p50 for Sweep. The Zeta fixture model is on external storage, so its durations are diagnostics rather than a speed comparison.

## 4. Jumps within the file

- **From the model:** a prediction whose first hunk is not on the cursor line ± 1 is shown as a jump (§6).
- **Jump probe:** after the user accepts an Edit Prediction, or after a burst that renamed or removed an identifier, the renderer looks for other occurrences in the buffer of the identifiers the last edit removed (the old name of a rename, the replaced call). For the nearest occurrence outside the last window it sends one `prediction.edit` with `focus` there. A non-empty result is shown as a jump; an empty one is dropped. At most one probe in flight; it is cancelled by typing.
- **Chaining:** after accepting, the next request starts from `Final.cursor`, so Tab, Tab walks a refactor.

## 5. The renderer (`apps/desktop/src/renderer/features/editor/prediction`)

- **Edit history:** per buffer, oldest first, at most 32 hunks, coalesced per burst. It is frozen at the first keystroke after a pause of at least 500 ms and refrozen on the next such keystroke; the request sends the frozen snapshot plus the live buffer (the spike: 1510 ms frozen vs 2154 ms live, same quality). An accepted Edit Prediction is added as a hunk.
- **Requests:** one in flight per Editor; any keystroke cancels it. A request starts after a pause (default 150 ms, longer for "Conservative") and on acceptance. The buffer must still match before display and again at accept (v1's fence).
- **Restraint guards (all on by default):**
  - Tab within 100 ms of a prediction appearing types a Tab instead of accepting.
  - Tab in leading whitespace types a Tab unless the prediction's first hunk is on the cursor line.
  - Esc dismisses and keeps predictions away until the cursor leaves the line or the user presses Enter. The command "Show last edit prediction" brings the dismissed one back.
  - Nothing while a mouse selection is in progress or any selection is non-empty.
  - The language server's completion popup and snippet fields win (v1).
  - A deletion of more than 5 lines needs a second Tab: the first changes the hint to "Tab again to delete N lines".
  - A prediction that would recreate text the user deleted, or remove text the user just typed, in this burst is never shown (the renderer's own check, on top of the predictor's `revert`).
- **Accepting** applies all hunks in one transaction (one undo step), annotated as accepted, then moves the cursor to `Final.cursor`.
- **Imports (§1):** after a burst settles, or after an acceptance, if the file's server publishes an unresolved-name diagnostic in the changed range, ask for `quickfix` code actions on it. Offer one only when exactly one action, or the one `isPreferred` action, edits only this file and only inserts. Its text comes from the server ("Add import from './x'"); the edit is the server's, never the model's.

## 6. Display (Paper first; DESIGN.md "proposed" until the owner accepts)

Mock these on Paper's Editor page next to TC1–TC5b, dark and light, then build them:

- **Insertion:** v1 ghost text, unchanged.
- **Replace within a line:** the replaced characters in the diff-removed tint, struck through; the new text as ghost text in the diff-added text colour right after them.
- **Multi-line replace:** removed lines tinted as removed, the new lines as a ghost block below them in the added colour, reserving space like v1's multi-line ghost.
- **Deletion:** the lines tinted as removed and struck through, and the keycap "Tab" with "delete N lines" at the end of the first line; past 5 lines, after the first Tab, "Tab again to delete N lines".
- **Jump:** at the end of the cursor line, a keycap "Tab" and "Ln 84" with an arrow pointing toward the target; when the target is off-screen, a marker at the Editor's top or bottom edge on that side. After the jump, the hunk shows as above.
- **Import:** at the end of the cursor line, "Tab" and the server's title.
- **Subtle mode:** only a small marker at the end of the cursor line (its arrow shows the direction); holding ⌥ (Alt) previews the prediction in place, and Tab still accepts.
- **Never:** a spinner, a loading state, animation of ghost or tints, or colour outside the diff tokens (rule/signals-are-rare). Colourblind palette (`-cvd`) diff tokens apply.

## 7. Settings and status

- Settings → Editor → Tab completion gains: Display (Full, Subtle); Aggressiveness (Conservative, Balanced, Eager: pause length, and whether jumps and deletions over 5 lines are offered); Accept key (Tab by default, remappable through the keymap); Off for a language (per-language list); the Model list includes recognised next-edit models with Recommended picking by machine (§2).
- The status card adds: the kind of model ("Next edit · Zeta 2.1" or "Insertion only · Mellum2"); acceptance over the last 200 shown predictions; shown per 100 keystrokes; undone within 30 s. When only a FIM model is found, one caption line says next edits need Zeta 2.1 or Sweep Next-Edit, with the llama-server command a copy action away.

## 8. Outcome log (local only)

- Written by the Desktop App's main process on the machine it runs on, never uploaded. One JSONL file under the app's data directory, capped at 5 MB (oldest half dropped when full). Settings has "Clear edit prediction history".
- **No source text, paths or identifiers.** One record per shown prediction: time, language, model, format, side (Client or Host), kind (insert, replace, delete, import, jump), hunk count, lines added and removed, latency (request to Final, Final to shown), outcome (accepted, dismissed with Esc, replaced by typing, superseded, ignored), whether it was undone within 30 s, and the guard that suppressed it, if any (also logged for never-shown predictions).
- The status card's numbers (§7) come from this log. v1.1 uses it for tuning by hand; nothing learns from it automatically.

## 9. Slices

1. **Predictor** (`packages/predict`, §3) with replay fixtures and the live harness. Also fixes v1's FIM prompt cache: `fitText` trims the prefix at a stable line boundary in fixed-size steps, so the prompt start doesn't move on every keystroke (the spike: 415 ms → 70 ms).
2. **Serving** (Daemon handler and `PredictionRpcs`, Client `LocalPredictor`, IPC bridge, model recognition and machine default in placement, §2). Depends on 1's API.
3. **Paper mockups** (§6, §7), recorded in DESIGN.md as proposed.
4. **Renderer** (§5, §6): state, display, accept, guards, history, jumps. Depends on 2 and 3.
5. **Imports, settings, status, outcome log** (§1, §7, §8). Depends on 4's state.

Each slice keeps `bun run typecheck && bun run test && bun run lint` green, runs the prediction bench where it touches a hot path, and adds tests that fail without the behaviour they name.
