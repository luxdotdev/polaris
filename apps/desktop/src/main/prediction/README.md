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
fixtures; they do not claim live model quality or latency. Polaris never starts
or stops a model server.

A server the user runs can enable prompt reuse and n-gram speculation, for example:

```sh
llama-server --model /path/to/next-edit.gguf --port 8080 --spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48 --cache-reuse 256
```
