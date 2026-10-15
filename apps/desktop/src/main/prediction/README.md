# Prediction serving in Desktop main

`LocalPredictor` lazily creates the FIM and edit predictors independently.
`MainPredictionPlacement` owns cancellation and side fallback for both request
kinds, with one active request per Host/Workspace. Successful rounds feed the
same per-side latency recorders. Closing a window releases its Workspaces.

The renderer first calls
`window.polaris.request("prediction.target", { hostKey, workspaceId })`.
It returns `{ editAvailable, target }`, where target is null or
`{ side, model, format, endpoint }`. This demand-only preview observes enable,
model and placement preferences without invalidating an active request. Use
`prediction.complete` for FIM when editAvailable is false.

Subscribe with `window.polaris.subscribe("prediction.edit", input, observer)`;
input is `PredictionCompletionInput & { focus: number | null, history:
ReadonlyArray<EditHistoryHunk> }`. The returned unsubscribe function cancels
consumption and HTTP on either serving side. Exactly one authoritative
`EditPredictionFeedItem.Final` carries the wire Final fields plus model, format,
side, machine, endpoint, context summary, placement latency and stage timings.
A failed attempt publishes nothing before fallback. History and buffer pass to
the shared predictor unchanged. The renderer still owns display and acceptance.

The predictor implementation is supplied by `@polaris/predict`. Serving tests
inject its interface and exercise the real predictor against isolated HTTP
fixtures; they do not claim live model quality or latency. Servers of the
user's own are never started or stopped; Polaris's own managed server
(`managed.ts`, ADR 0049) is the local Daemon's: `prediction.managed` reports
or drives it for either side, `prediction.managed.watch` streams its state,
`prediction.modelsDir.choose` picks the Client's model folder, and a request
to a managed endpoint on either side first asks its Daemon to start it (which
also resets its idle clock). The answer's `launched` says the caller waited
for the model to load: that request restarts its latency clock and leaves no
sample, and the status's `loadMs` is the card's "Load time" fact.

## Local outcomes and metrics

`window.polaris.notify?.("prediction.outcome", record)` is a one-way IPC send;
it has no reply and never waits for disk. The shared Effect `PredictionOutcome`
schema rejects extra keys and accepts only enum IDs and numeric/count fields:

```
{ time, language, model, format, side, kind, hunkCount, linesAdded, linesRemoved,
  requestToFinalMs, finalToShownMs, outcome, undoneWithin30s, guard }
```

`time` is the shown time in Unix milliseconds (the suppression time if never
shown). Side is `client | host`; kind is `insert | replace | delete | import |
jump`. Format is a protocol FIM/edit format, or null for an import. Outcome is
`accepted | dismissed-esc | replaced-by-typing | superseded | ignored`, or null
for a never-shown suppression. Such a record needs a guard and null
`finalToShownMs`. Guards are `revert | outside-window | unstable | recent-edit |
selection | completion-popup | snippet | aggressiveness`, or null.

Send one finalized record per shown prediction. The renderer observes undo for
30 seconds after acceptance and sets `undoneWithin30s` only for an undo inside
that period; finalize early on disposal, counting only observed undo. Main
needs no prediction, buffer, Host or Workspace identifier. Predictions that
were never shown can be recorded for guards; they do not affect shown metrics.
Use `outcomeLanguageId` and `outcomeModelId` from `shared/predictionOutcomes.ts`
before recording: known language IDs and canonical model IDs (`zeta-2.1`,
`sweep-next-edit`, `mellum-2`, `qwen-2.5-coder-1.5b`) pass, other IDs become
`unknown`. Endpoint aliases, quantization paths, code and user identifiers
cannot be stored in these fields.

Send `notify?.("prediction.keystrokes", { keystrokes: n })` with a positive
delta since the preceding counter message, including typing that produces no
prediction. Count document-input keystrokes once across Editors; exclude
prediction application, undo, programmatic edits and navigation. Flush a
pending delta with an outcome or on Editor disposal. This separate counter
allows shown-per-keystroke metrics to include periods with no shown prediction.

`request("prediction.metrics", {})` returns `PredictionMetrics`: acceptanceRate
is a fraction over the latest 200 shown by shown timestamp, with
`acceptanceWindow` reporting the actual sample size. `shown`, `accepted`,
`keystrokes`, `shownPer100Keystrokes`, `undoneWithin30s`, `undoneRate`, and
`countsByKind` cover the retained log; undoneRate divides observed undos by
accepted predictions. A ratio with no denominator is null. Kind counts exclude
never-shown guards. `request("prediction.outcomes.clear", {})` erases both
outcomes and counters and returns null after the write completes.

The sole file is `<userData>/prediction-outcomes.jsonl`, private to this
Desktop App. Counter lines contain only `{ keystrokes }`. Writes coalesce on
the next event-loop turn, append asynchronously and serialize with clear and
queries. At 5,000,000 bytes the oldest half of the lines is dropped, atomically,
before further appends; startup repairs a torn tail and rejects invalid rows.
Shutdown drains queued writes before quitting. No interval, network request,
or idle wakeup is added. Disk failures make metrics/clear return `Unavailable`.

## Edit Prediction preferences

The existing per-Host `prediction.settings.get` / `prediction.settings.set`
accept `{ hostKey }` / `{ hostKey, preferences }`. Replies retain the v1
placement/model/format/hostEndpoints fields and add:

| Field | Default | Values |
| --- | --- | --- |
| display | `full` | `full`, `subtle` |
| aggressiveness | `balanced` | `conservative`, `balanced`, `eager` |
| acceptKey | `editor.prediction.accept` | Existing keymap binding ID; default key is Tab |
| disabledLanguages | `[]` | Deduplicated language IDs, at most 256 |
| editModel | `null` | Recommended, or an endpoint model ID recognized as Zeta 2.1 / Sweep Next-Edit |

`editModel` overrides next-edit placement without replacing the v1 FIM model.
Recommended is Sweep Next-Edit on every machine (owner, 2026-10-15). The legacy
`format` field also accepts next-edit formats. Missing new fields in v1 files
decode to defaults; the next settings write persists them while preserving
unrelated settings and the separate global Client endpoint list.

Replies include derived `restraints`; older preview Clients may omit it, so
consumers can use `predictionRestraints(preferences.aggressiveness)` as well:

| Aggressiveness | pauseMs | jumpsOffered | jumpProbe | largeDeletionsOffered |
| --- | --- | --- | --- | --- |
| conservative | 300 | false | `off` | false |
| balanced | 150 | true | `spec` | true |
| eager | 75 | true | `reach` | true |

Balanced keeps the spec's default features; Eager shortens the pause and
probes with the reach signals (`REACH_SIGNALS`), which reach more targets
but showed more wrong and dangerous edits on held-out cases. The
renderer still applies every safety guard, including a second Tab for large
deletions. A successful settings write broadcasts `onAppEvent` with
`{ kind: "prediction-settings", hostKey, preferences, restraints }` after
persistence, then invalidates that Host's active placement. Display, pause,
language suppression and keymap execution remain renderer responsibilities.

A server the user runs can enable prompt reuse and n-gram speculation, for example:

```sh
llama-server --model /path/to/next-edit.gguf --port 8080 --spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48 --cache-reuse 256
```
