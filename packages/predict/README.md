# Shared FIM predictor

`@polaris/predict` runs in the Client main process and the Daemon. Runtime modules use TypeScript, Effect and standard web APIs only; they do not import Electron, Bun or Node APIs. `createPredictor()` retains a bounded rolling latency recorder and starts no requests or timers until its stream is consumed.

```ts
const predictor = createPredictor();
const stream = predictor.complete(request, { signal });
```

`request` is the protocol's `PredictionRequest`. `Delta` contains provisional raw model output. `Final.text` is authoritative after stop-marker removal, suffix-overlap removal, line limiting and whitespace-only abstention. A successful stream emits exactly one Final. Interrupting consumption or aborting `signal` cancels the HTTP request and response body. Errors and cancellations produce no Final or latency sample. Callers cancel the previous request when the buffer changes and check that the buffer is still current before acceptance.

The three formats are `mellum-spm`, `qwen-fim`, and generic `suffix` (OpenAI-compatible only). Mellum uses `<filename>` blocks then suffix/prefix/middle markers. Qwen uses its pipe-delimited FIM tokens. This ports the Polaris TABSPIKE formats from `spike/tab-completion` at `b62492a5`; no external project implementation was copied. The formats were checked against the [Mellum card](https://huggingface.co/JetBrains/Mellum-4b-base), [Mellum2 card](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Base) and [Qwen card](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B). Mellum2's card documents completions but does not specify the earlier Mellum FIM grammar; the shared Mellum2 server is covered by the live test.

`countTokens(text)` is a conservative UTF-8 byte upper bound for byte-level tokenizers, **not an exact model token count**. `packContext(context, budgetTokens, counter?)` selects whole pieces in stable order: definitions, import outlines, edit hunks, diagnostics. It skips oversized pieces. `buildPrompt` reserves up to half its input budget for context, counts format markers, and fits the nearest prefix and suffix without splitting Unicode code points. Callers can supply a model tokenizer through `PredictionOptions.countTokens`. Generation has a separate `maxTokens` budget.

OpenAI-compatible endpoints use `/v1/completions` and SSE; Ollama uses `/api/generate`, NDJSON and `raw:true`. Base URLs may include `/v1` for OpenAI-compatible servers. Requests disable redirects and ambient credentials. Provider payloads are decoded with Effect Schema; truncated streams and malformed/oversized records fail. Endpoint p50 uses at most 31 successful timings for each of at most 32 endpoints; no idle timer performs eviction.

The v1 seam is the `Predictor` interface and the protocol formats. Next-edit models need a separate edit result contract; they are not represented as FIM text.

## Verification

- `bun test packages/predict apps/daemon/src/prediction apps/desktop/src/main/prediction`
- `POLARIS_PREDICTION_LIVE=1 bun test packages/predict/src/live.test.ts`

The live harness uses an already-running Mellum2 server, default `http://127.0.0.1:8080`, model `mellum2-12b-a2.5b`. Override `POLARIS_PREDICTION_URL` / `POLARIS_PREDICTION_MODEL` as needed. It never starts or stops the server. Recorded model output in `postprocess.test.ts` comes from TABSPIKE's `llama-mellum-full.jsonl`, c02 A. The live-recorded `src/fixtures/mellum-sum.sse` also replays through the complete predictor, split at every byte. Other streaming fixtures are synthetic boundary/error cases.

The Daemon lazily imports its predictor for `prediction.complete`. `LocalPredictor.layer` in `apps/desktop/src/main/prediction/localPredictor.ts` exposes the same `complete` and `p50` functions. TPLACE owns placement, fallback and service composition; TCTX owns Host context assembly and Trust checks. Prediction completion has no EventStore dependency and changes no command, commit, acknowledgement or recovery semantics.
