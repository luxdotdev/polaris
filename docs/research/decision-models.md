# Research: System One decision models for the Risk Summary classifier

Linear: [ENG-186](https://linear.app/luxdev/issue/ENG-186) (follow-up to [risk-summary.md](risk-summary.md) §2). Researched 2026-10-13 against primary sources: vendor docs, model cards, source repos at pinned commits, package registries. Every claim links to its source. Where a vendor or author makes a claim about its own model, that is noted. Nothing was signed up for and no API key was used, so no number here was measured by us.

Context: Layer 2 of the Risk Summary asks a decision model narrow, typed questions about each hunk. On 2026-09-27 the only option researched was TypeSafe's hosted Jev. Since then Cloudflare has shipped Clef, and several open-weight models that speak Jev's API have appeared. This file asks whether Polaris can have one Classifier interface with interchangeable backends, and which backends fit a Daemon that must also run on a Raspberry Pi 4.

## TL;DR

- **One wire shape has won.** Jev's `POST /v1/systemone` request (`state` plus a `questions` map of `noul` / `choice` / `score`) and its response (`answers`, `probabilities`, `confidence`, `legend`, `usage`) are now served by Jev, Clef (on Workers AI, with an envelope), Kev, Laya, Von and llama.cpp's server. A Polaris `Classifier` can be that shape with a base URL and an auth header per backend. The differences are limits (context, options), truncation behaviour and confidence calibration, not shape.
- **Jev has barely changed.** Still `jev-1.13.0`, same price ($0.042/M input tokens), same API, still early access, no free tier. The rate limits on the Models page now read 100K tokens/s and 80 requests/s (2026-09-27: 250K tokens/s, 1,200 requests/min). The JS SDK is still 0.6.0. The Python SDK went 0.6.0 → 0.7.4. The jaggedness page was re-reviewed 2026-10-02 with the same warnings, including prompt injection.
- **Clef is Cloudflare's own model, not a Cloudflare edition of Jev.** The Workers AI team post-trained Qwen backbones (Clef 27B, Clef-flash 9B, Clef-omni 30B-A3B). The weights are Apache-2.0 on Hugging Face, and the API is Jev-compatible. Clef-flash costs $0.038/M (Clef $0.24/M). The free allocation is 10,000 Neurons a day, about **2.9M input tokens/day on Clef-flash** or 0.46M on Clef. Any Bun process can call it over REST with an account ID and an API token. Two catches: hosted Clef-flash's context was cut to 24,576 tokens, and Workers AI **silently truncates** an over-long `state`.
- **Kev is real, Apache-2.0, and impressive, but it is a research project by one author.** It is not a TypeSafe product, and it is GPU or Apple-silicon software, not something for a Pi. Kev 1.0 (2026-10-01) is four sizes (0.8B/4B/9B/27B) on Qwen bases, served by a Python server that matches Jev's API. It is not on PyPI, and there is no Docker image, binary or npm package. Its own numbers put Kev-27B within a point of Jev out of domain and the small sizes well behind. Kev-4B also runs under llama.cpp (GGUF), which is the more practical route.
- **For a Pi 4 or a small VM, the realistic local option is a ~400M encoder model (Laya, Von) through llama.cpp or ONNX, not Kev.** llama.cpp merged a `/v1/systemone` server endpoint on 2026-10-02 (Laya, Kev, OpenJev and others). Laya's Q8 GGUF is 0.45 GB. Its accuracy is far below Jev (Von's own JevBench table: composite ~30 vs Jev 63), so it suits only cheap first-pass questions.
- **Nobody has a credible code-review eval.** Kev's model card reports that before training on it, every model it scored, Jev included, was near chance on CodeReviewer's "did a reviewer comment on this hunk" task. On a held-out prompt-injection source Jev scored 0.893 and Kev-4B 0.753. Clef claims CRUXEval 86.7 vs Jev 73.0 (code reasoning, vendor-run). The design consequence from risk-summary.md stands: ask pointed, rule-specific questions, and never let a decision model suppress a Layer 1 finding.

---

## 1. Jev now (TypeSafe)

| Fact | 2026-09-27 | 2026-10-13 | Source |
|---|---|---|---|
| Model | `jev-1.13.0`; `jev-latest` | Same. `jev-preview` also resolves to `jev-1.13.0` ("no preview build available") | [Models](https://docs.typesafe.ai/models) |
| Status | Early access | Still "early access" (Series A post, 2026-10-12) | [Series A](https://typesafe.ai/blog/series-ai) |
| Price | $0.042/M input, output free | Same; no free tier mentioned | [Models](https://docs.typesafe.ai/models) |
| Rate limits | 250K tokens/s, 1,200 req/min | **100K tokens/s, 80 req/s**; "adjusting dynamically", 429 with `retry-after` | [Models](https://docs.typesafe.ai/models) |
| Context | 64k per request; 32k for state + longest question | Same; text only | [Models](https://docs.typesafe.ai/models) |
| API | `POST https://api.typesafe.ai/v1/systemone` | Unchanged. Choice ≤ 255 options; Score 2–10 levels; `confidence` on choice and score only | [API reference](https://docs.typesafe.ai/api) |
| JS SDK | `@typesafe-ai/sdk` 0.6.0, MIT | Still 0.6.0 (published 2026-09-15), Node ≥ 20 | [npm](https://registry.npmjs.org/@typesafe-ai/sdk), [GitHub](https://github.com/typesafe-ai/typesafe-sdk-js) |
| Python SDK | 0.6.0 | 0.7.4 (2026-10-09): pydantic `response_model` (0.7.0, breaking serde change), HTTP/2 extra, connection-pool tuning | [changelog](https://docs.typesafe.ai/sdk/python/changelog), [repo](https://github.com/typesafe-ai/typesafe-sdk-python) |
| Data handling | No training on requests; ZDR for enterprise | Same wording | [Models](https://docs.typesafe.ai/models), [Legal](https://docs.typesafe.ai/legal) |

New features since 2026-09-27: none at the API level. There is no batch endpoint, no caching, no new eval tooling, and no changelog for the model. The docs added cookbooks: speculative fan-out (many questions in one request), confidence-gated routing, composite scoring, and an AutoResearch cookbook ([docs index](https://docs.typesafe.ai/llms.txt)). Packing every question into one request is TypeSafe's batching answer; its own cookbook claims "12.2x cheaper and 10.0x faster with no change in answers" ([Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)). That is a vendor claim.

Other routes to Jev:
- **Vercel AI Gateway** serves `typesafe-ai/jev` (2026-09-16) ([changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)) and accepts TypeSafe clients directly ([changelog](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev)).
- **AI SDK 7** (`ai@7.0.139`) has `experimental_decide` with an `Experimental_DecisionModelV4` provider spec. `experimental_evaluate` is now a deprecated alias (verified in the package's `dist/index.d.ts`). Its yes/no type is named `boolean`, not `noul` ([reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate), [guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)). An experimental API that was renamed within a month is not a stable abstraction to build on.
- **`system-one-adapter-python`** (MIT, TypeSafe) is a "drop-in TypeSafeClient replacement backed by LLM APIs" (OpenAI, Anthropic, Gemini) ([repo](https://github.com/typesafe-ai/system-one-adapter-python)). The idea is useful for Polaris: an LLM-backed `Classifier` is a valid fallback backend.

Jaggedness ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13), "Last reviewed 2026-10-02"). Unchanged in substance: literal reading, no arithmetic or counting, accuracy falls as unrelated state grows, and "Adversarial content… an injected instruction, a deliberately misleading framing, or text that argues for its own classification, can move the answer. We expect to improve on this in the future."

TypeSafe's 2026-10-12 post says its model releases will carry "no standard benchmark table", and new evals will be "dated snapshots and immediately retired once posted" ([Lies, Damned Lies, and Benchmarks](https://typesafe.ai/blog/antibenchmaxxing)). Expect no TypeSafe-published code-review numbers.

## 2. Clef (Cloudflare)

**What it is.** "Clef and Clef-flash, the first models trained by the Cloudflare Workers AI team… decision models… in the same family as Typesafe's Jev" (launch changelog, 2026-10-01; [changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/), [blog](https://blog.cloudflare.com/clef-decision-models/)). Each model is a Qwen backbone plus a "joint schema head" that scores all options of all questions jointly ([Clef-flash card](https://huggingface.co/Cloudflare/clef-flash)).

| Model | Workers AI ID | Base | Hosted context | Price / M input | Neurons / M | Weights |
|---|---|---|---|---|---|---|
| Clef | `@cf/cloudflare/clef` | Qwen3.8-27B | 65,536 | $0.240 | 21,818 | [HF](https://huggingface.co/Cloudflare/clef) @ `0b331204`, Apache-2.0 |
| Clef-flash | `@cf/cloudflare/clef-flash` | Qwen3.5-9B | **24,576** (64K at launch) | **$0.038** (was $0.090) | 3,455 | [HF](https://huggingface.co/Cloudflare/clef-flash) @ `8b2e5fd1`, Apache-2.0 |
| Clef-omni | `@cf/cloudflare/clef-omni` | Qwen3-Omni-30B-A3B | 64K | $0.150 | 13,636 | [HF](https://huggingface.co/Cloudflare/clef-omni) @ `0db1cd26`, Apache-2.0 |

Sources: [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers AI changelog](https://developers.cloudflare.com/changelog/product/workers-ai/) (2026-10-09: Clef-omni launched, Clef-flash price cut and context cut to 24K "0.24% of requests exceed 24K", Clef up to 2x faster), and the model schema [`clef-flash.json`](https://github.com/cloudflare/cloudflare-docs/blob/970ac7295d27cc146b7d88ed29f4463a4f02b78d/src/content/workers-ai-models/clef-flash.json). Output tokens are not charged.

**Free tier.** 10,000 Neurons/day on both Workers Free and Paid. After that it is $0.011 per 1,000 Neurons on Paid only; on Free, requests stop at the allocation ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). That works out to ~2.89M input tokens/day on Clef-flash, or ~0.46M on Clef. At ~1–2k tokens per hunk question, that is roughly 1,500–2,900 Clef-flash calls a day for free. That is generous for one developer's reviews, not for a busy team.

**API shape.** The REST endpoint is `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`, with `Authorization: Bearer <API token>`. The token needs "Workers AI - Read" and "Workers AI - Edit" ([model page](https://developers.cloudflare.com/workers-ai/models/clef/), [REST get-started](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)). The body is Jev's: `model` (`clef` or `clef-flash`), `state`, and 1–64 `questions`. A Choice has 2–255 options and a Score 2–10 levels (the same limits as Jev). Clef adds `images` (max 4). The answer schema matches Jev field for field, including `confidence` on choice and score and `legend` on score ([schema](https://github.com/cloudflare/cloudflare-docs/blob/970ac7295d27cc146b7d88ed29f4463a4f02b78d/src/content/workers-ai-models/clef-flash.json)). Differences from Jev:
- The REST response is wrapped in Cloudflare's v4 envelope `{result, success, errors, messages}` ([REST get-started](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)). The path is not `/v1/systemone`, so an adapter must unwrap `result`. The Jev SDK cannot simply be pointed at it.
- "Long text state is truncated to fit the model's token limit" ([model page](https://developers.cloudflare.com/workers-ai/models/clef/)). Jev, Kev and Laya's server refuse with a 422 instead. The Daemon must budget tokens itself, or it will get answers about a cut-off diff without knowing.
- Rate limits for Clef are not documented ([limits](https://developers.cloudflare.com/workers-ai/platform/limits/) lists 2,000 req/min for text classification only).

**From a Bun process on a Host with the user's own account: yes.** It is a plain authenticated `fetch`; no Worker or binding is required (REST and AI Gateway are both documented routes, [changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)). The user supplies an account ID and a scoped API token.

**Latency (vendor).** Median/p95: Clef 209.3/238.6 ms, Clef-flash 38.8/122.4 ms, Jev 524.1/536.0 ms, "across our 43 benchmark runs" ([changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)). Independent third-party runs put Jev's p50 at 236–276 ms ([AbdelStark/jev-benchmarks](https://github.com/AbdelStark/jev-benchmarks), [nibzard/decision-model-benchmark](https://github.com/nibzard/decision-model-benchmark), as cited by Laya's card), so Cloudflare's Jev figure looks pessimistic.

**Quality (vendor).** Clef leads "7 of 10 decision benchmarks", and the card has a 41-row Decision Index table against Jev, Kev 9B and Laya ([Clef-flash card](https://huggingface.co/Cloudflare/clef-flash)). Jev still leads on reasoning-heavy rows: GPQA 78.3 vs 48.0, BBH 92.9 vs 73.7, MMLU-Pro 82.7 vs 65.9, When2Call 81.0 vs 72.4. The blog says Jev's context is 32k, but Jev's docs say 64k per request with 32k for state ([Models](https://docs.typesafe.ai/models)). Cloudflare's framing is misleading there.

**Data handling.** Cloudflare does not use Customer Content (inputs and outputs) to "train any AI models made available on Workers AI" without explicit consent. No retention period is stated ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), updated 2026-04-21). The blog adds that Cloudflare doesn't "read, store, or train on your requests or responses" unless you opt into fine-tuning ([blog](https://blog.cloudflare.com/clef-decision-models/)).

**Self-hosting Clef** is possible (Apache-2.0) but needs datacentre GPUs. The card is "tested… on a single H200" and serves through an SGLang Docker image `lmsysorg/sglang:dev-clef` at `/v1/systemone`. Loading uses custom code (`joint_schema_model.py`) ([card](https://huggingface.co/Cloudflare/clef-flash)). llama.cpp support for Clef is "planned as a follow-up" ([llama.cpp#29818](https://github.com/ggml-org/llama.cpp/pull/29818)). Clef is not an option for a Pi or a small VM.

## 3. Kev (jaredpalmer/kev)

**Identity and licence.** [github.com/jaredpalmer/kev](https://github.com/jaredpalmer/kev), pinned at [`85ccf56a`](https://github.com/jaredpalmer/kev/tree/85ccf56a0afb952323c621055b02876e8498d60c) (2026-10-12). `LICENSE` is the Apache License 2.0, and GitHub detects `Apache-2.0`. Its description: "Jev-like family of decision models built on top of Qwen3.5/3.8 you can train and run on your own." It is Jared Palmer's personal repo, with no affiliation to TypeSafe or Cloudflare stated. It is "based on the architecture described in [Jev's Architecture Unmasked](https://archerhume.com/posts/jevs-architecture-unmasked)", a third-party post ([README](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/README.md)).

**Weights licence (separate from the code).** Every Hub repo declares `apache-2.0`. The 0.8B/4B/9B models are a LoRA adapter plus a head on Qwen3.5 `-Base` models (Apache-2.0); 27B is full bf16 weights from Qwen3.8-27B (Apache-2.0) ([kev-4b](https://huggingface.co/jaredpalmer/kev-4b) @ `6cfce5c2`, [release kev-1.0](https://github.com/jaredpalmer/kev/releases/tag/kev-1.0)). The model cards say "No output of Jev… was used" in training, and the CodeReviewer diffs used are "kept only from permissively licensed projects" ([kev-27b card](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/docs/model-cards/kev-27b.md)). The adapters ship a `head.pt` (a PyTorch pickle), so load it only from a pinned revision.

**What it is.** Weights, a training and eval harness, and a Python HTTP server. `python -m kev.serve` answers `POST /v1/systemone` on `127.0.0.1` ("The API matches TypeSafe's System One… the TypeSafe Python SDK works against a Kev server unchanged"). It refuses states over 65,536 tokens with a 422 and has optional `KEV_API_KEY` bearer auth. It adds `/v1/systemone/permute` for option-order checks ([README](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/README.md)). Choice and Score accept 1–255 entries. Confidence uses TypeSafe's reference formulas from `system-one-adapter` 0.2.1.

| Model | Validated context | Hardware (author) | Model time (author) |
|---|---|---|---|
| Kev-0.8B | 8,192 | "any 4 GB GPU"; any Apple-silicon Mac | 22.7 ms (L4); 149 ms on an M5 |
| Kev-4B | 8,192 | L40S/H100; 32 GB Mac | 18.1 ms (H100); 721 ms on an M5 (136 ms cached) |
| Kev-9B | 8,192 | ~17 GB GPU; Mac not measured | 24.0 ms (H100) |
| Kev-27B | 65,536 | 80 GB GPU; 96–128 GB Mac expected, not measured | 46.5 ms (B200) |

Model time excludes the network, and the author's examples use 5–6 short questions ([README: Serving performance](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/README.md)). CPU serving exists (`--device cpu`, fp32 by default), but no CPU numbers are published. Raspberry Pi and arm64 Linux are not mentioned anywhere in the repo (code search for "raspberry", "gguf" and "onnx" returned nothing). **Through llama.cpp** there is `ggml-org/Kev-4B-GGUF` (Q4_K_M 3.03 GB, Q8_0 4.48 GB) ([HF](https://huggingface.co/ggml-org/Kev-4B-GGUF)). That could load on an 8 GB Pi 4, but a 4B model on a Cortex-A72 would take seconds per call. That is an estimate; nobody has measured it.

**Distribution.** Install from source with `uv` on Python 3.12/3.13. It is "not published to PyPI" (`pip install kev` is a different 2016 package). There is no Docker image or binary. Other routes are a Modal deploy script, a Hugging Face Space demo, and agent skills (`kev-deploy`, `kev-finetune`).

**Maturity.** 9,061 stars, 607 forks, 342 commits, 35 open issues. Created 2026-09-17, last pushed 2026-10-12 ([API](https://api.github.com/repos/jaredpalmer/kev)). Releases are `v0.1.0` (2026-09-17), `kev-family` (2026-09-20) and `kev-1.0` (2026-10-01). CI runs unit, generator and convention tests without weights, and the README's numbers are checked against committed reports in CI (`scripts/verify_claims.py`). The project is unusually rigorous for its age (registered test reads, paired bootstrap intervals, an eval audit that dropped three suites), but it is four weeks old and has one maintainer.

**Quality (author's claims; Jev was read only on development splits).**

| | Kev-0.8B | Kev-4B | Kev-9B | Kev-27B | Jev |
|---|---|---|---|---|---|
| Held-out datasets index (breadth-v1 test) | 23.3 | 38.0 | 41.0 | 52.3 | 54.0 |
| New-source accuracy (transfer-v4 dev) | 0.648 | 0.817 | 0.820 | 0.851 | 0.857 |
| Share automatable at a 5% error budget, new sources | 0.14 | 0.52–0.69 (4B/9B/27B) | | | 0.70 |
| MMLU-Pro | 0.230 | 0.565 | 0.590 | 0.675 | 0.840 |

Source: [Kev 1.0 release notes](https://github.com/jaredpalmer/kev/releases/tag/kev-1.0). Independent: Cloudflare's table scores "Kev 9B" below Jev on most rows ([Clef card](https://huggingface.co/Cloudflare/clef-flash)), and that is a competitor's run. Kev's own limitations: "Changing option order can change an answer"; "One temperature per model cannot reorder confidences, so… the models automate fewer decisions than Jev out of domain"; the small sizes are only validated to 8k tokens.

## 4. The "etc.": other options

| Option | What | Licence | Size / runtime | Notes |
|---|---|---|---|---|
| **Laya** (Convai Innovations) | ModernBERT/mmBERT encoder with decision heads | Apache-2.0 ([HF](https://huggingface.co/convaiinnovations/laya) @ `7b928d82`; [code](https://github.com/NandhaKishorM/laya) @ `c73908d9`) | 421M; GGUF Q8 0.45 GB ([ggml-org/Laya-GGUF](https://huggingface.co/ggml-org/Laya-GGUF)); ONNX for Node via [`@receptron/laya`](https://github.com/receptron/laya) (MIT, @ `6478649e`, ~1.7 GB fp32, "roughly 2 GB of RAM") | Vendor: 32.8–39.5 ms per question on a T4, "193–464 ms (CPU)". Default context 512–1,024 tokens (8,192 max). Its own card: Banking77 0.425 vs Jev 0.870; `noul` "can follow its option labels instead of the state". `laya-serve` speaks `/v1/systemone`. |
| **Von** | 395M ModernBERT encoder | Apache-2.0 ([repo](https://github.com/wfzyx/von) @ `9319ced7`) | CPU first (OpenVINO); Docker `ghcr.io/wfzyx/von:cpu` (amd64 only); ~3 GB weights | Author: p50 0.096 s on 4 vCPU. JevBench v1.4 composite 27.5 vs Jev 63.3. Middle-truncates by default, or 422 with `--on-overflow refuse`. |
| **llama.cpp `/v1/systemone`** | Server endpoint for decision models | MIT | `llama-server -hf ggml-org/{Laya,Kev-4B,OpenJev,lev,Julia-1}-GGUF`; arm64 builds | Merged 2026-10-02 as [`a4cb4c61`](https://github.com/ggml-org/llama.cpp/pull/29818). Open follow-ups: a model-agnostic implementation ([#29832](https://github.com/ggml-org/llama.cpp/pull/29832)), H2O-Lightning-4B ([#30361](https://github.com/ggml-org/llama.cpp/pull/30361)). This is the most portable local runtime. |
| **OpenJev** | Large open model with vision | see HF | GGUF Q4 19.4 GB ([HF](https://huggingface.co/ggml-org/OpenJev-GGUF)) | Too large for a Host default. |
| **LLM adapter** | Any LLM behind the System One shape | MIT ([repo](https://github.com/typesafe-ai/system-one-adapter-python)) | Python | The fallback when no decision model is configured; Polaris could do the same in TypeScript against the Harness's model. |

Community hubs that track more entries (Decider, Tev1, JevK5, PostHog's Jeeves, H2O-Lightning-4B) are unvetted aggregators: [awesome-system-one](https://github.com/yanng981/awesome-system-one) (CC0), [systemonemodels.org](https://systemonemodels.org/examples/alternatives/). Treat their claims as unverified.

## 5. Compatibility matrix

| | Jev | Clef / Clef-flash (Workers AI) | Kev server | Laya (`laya-serve`, llama.cpp) | Von |
|---|---|---|---|---|---|
| Path | `/v1/systemone` | `/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef` | `/v1/systemone` | `/v1/systemone` | `/v1/systemone` |
| Response | bare | **wrapped in `{result, success, errors, messages}`** | bare | bare | bare + extras |
| Auth | Bearer API key | Bearer CF API token + account ID | optional `KEV_API_KEY` | optional `LAYA_API_KEY` | optional `VON_API_KEY` |
| Types | noul/choice/score | same; + `images` | same | same | same |
| Questions per request | not capped in docs | 1–64 | unlimited (16k-token passes) | not capped | not capped |
| Choice options | ≤ 255 | 2–255 | 1–255 | any, but ~20 practical (shared head budget) | K options |
| Score levels | 2–10 | 2–10 | 1–255 | any | ordinal |
| `confidence` | choice, score | choice, score | choice, score (TypeSafe formulas) | choice, score | choice, score; refittable |
| Context | 64k request / 32k state | 64k / **24k** (flash) | 64k served; 8k validated (≤ 9B) | 512–1,024 default, 8k max | 8k default |
| Over-long state | error | **silent truncation** | 422 | 422 (server) | middle-truncate or 422 |
| Runs on Pi 4 | n/a (hosted) | n/a (hosted) | not measured; 4B GGUF via llama.cpp, estimated seconds per call | likely (0.45 GB Q8); not measured | amd64 image only |

Sources: the sections above. A single `Classifier` service with backends `{ jev, workers-ai, systemone-http(baseUrl) }` covers every row. Clef needs an envelope unwrap. Polaris must enforce its own token budget, because truncation differs. Confidence values are **not comparable across backends**: each model calibrates differently (Kev's single temperature vs Jev's ranking), so thresholds have to be tuned per backend and pinned model version.

## 6. What matters for code review

- **Published code evals are thin and mostly self-run.** Kev's devtools-v1 suite (CodeReviewer hunk-commented, CommitPackFT commit type, FlakeFlagger, Aegis) is the only one on code review. Its card warns that "before training, every model scored, including Jev, was near chance on CodeReviewer and FlakeFlagger… which may be the labelling heuristic being learned" ([kev-4b card](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/docs/model-cards/kev-4b.md)). Clef's CRUXEval (86.7 Clef vs 73.0 Jev) measures code *reasoning*, not review ([Clef card](https://huggingface.co/Cloudflare/clef-flash)). There is still no evidence that any decision model can tell whether a hunk is risky from a generic question. This matches the third-party jev-review finding in risk-summary.md.
- **Prompt injection.** Jev's jaggedness page still says injected content "can move the answer". On the evaluation-only prompt-injection source of devtools-v1, the scores were Jev 0.893 and Kev-4B 0.753 ([kev-4b card](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/docs/model-cards/kev-4b.md)). Kev escapes delimiter-like strings in input ([README](https://github.com/jaredpalmer/kev/blob/85ccf56a0afb952323c621055b02876e8498d60c/README.md)), which helps with token smuggling but not with persuasion. The diff is attacker-controlled. Decision-model output can raise or rank a risk, but never clear a Layer 1 finding.
- **Option order.** Kev documents that reordering options can change an answer and ships `/permute` to measure it. Polaris should fix option order per question and version it with the question.
- **Pin everything.** Use a pinned Jev version (`jev-1.13.0`), a Workers AI model ID (Cloudflare changed Clef-flash's context and serving stack nine days after launch), and a Hub revision for local weights. Thresholds tuned on one do not transfer.

## Open questions

- Measure on Polaris's own labelled hunks: Jev vs Clef-flash vs Laya/Kev-4B through llama.cpp, for accuracy, calibration and dismissal rate. This needs a Jev key and a Cloudflare account, which this research did not use.
- Measure Laya Q8 and Kev-4B Q4 under `llama-server` on the Pi 4 (`lucas-rpi`) for latency and resident memory against the Daemon's budget.
- Clef rate limits on Workers AI Free are undocumented. Find out before making Clef a default.
