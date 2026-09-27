# Completion providers: ChatGPT sign-in vs local models

Research for [ENG-173](https://linear.app/luxdev/issue/ENG-173) (Polaris planning map ENG-167). Researched 2026-09-27.

Source snapshots:
- Zed: `zed-industries/zed` @ [`e683fd7`](https://github.com/zed-industries/zed/tree/e683fd7b465ecfb42b1da88ff685d204c2781076) (2026-09-27)
- Codex: `openai/codex` @ [`32f5784`](https://github.com/openai/codex/tree/32f578485143354d1c321840a3e990aabdbaca9c) (2026-09-27)

Links below use `Z=` for `https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076` and `C=` for `https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c`. Links are written out in full.

## TL;DR

- **Inline chat through ChatGPT sign-in works, and Zed ships it.** Zed's "ChatGPT Subscription" provider runs a PKCE OAuth flow against `auth.openai.com` using the Codex CLI's own OAuth client ID. It then calls `https://chatgpt.com/backend-api/codex/responses`, the same private backend Codex uses. Zed's Inline Assistant can use any configured LLM provider, so this one counts. ([provider source](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L35-L38), [inline assistant docs](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/inline-assistant.md?plain=1#L24))
- **Tab completion through ChatGPT sign-in does not work, and Zed doesn't attempt it.** Zed's edit-prediction providers are Zed (Zeta), Copilot, Codestral, Ollama, OpenAI-compatible `/v1/completions`, and Mercury. The ChatGPT subscription isn't one of them. The Codex backend only offers the Responses API with reasoning models (lowest effort `low`). It has no FIM or `/completions` endpoint. ([enum](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/settings_content/src/language.rs#L93-L101), [Codex model catalog](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/models-manager/models.json))
- **Which models you get depends on the account.** Zed asks `GET /backend-api/codex/models?client_version=…` for the list your account can see. It falls back to a hardcoded list (gpt-5.6-sol/terra/luna, gpt-5.5, gpt-5.4, gpt-5.4-mini) and uses `gpt-5.6-luna` as the "fast" model. Codex's own catalog already lists `gpt-6-*` models. ([Zed](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L216-L224))
- **Terms and risk: tolerated, not a documented public API.** OpenAI's Terms of Use prohibit programmatically extracting Output and circumventing rate limits. No public "Sign in with ChatGPT for third-party model calls" program exists. Zed says it is "work[ing] with OpenAI" and that "OpenAI continues to support subscription-based access for third-party tools." Treat it as a sanctioned-by-practice integration that OpenAI can revoke. ([Zed blog](https://zed.dev/blog/chatgpt-subscription-in-zed), [OpenAI ToU](https://openai.com/policies/row-terms-of-use/))
- **For completion, run locally.** Zeta 2.1 (8B, Seed-Coder-8B base, Apache-2.0, GGUF quants) is the best open *next-edit* model. On Apple Silicon an 8B Q4 model generates about 60–100 tok/s on Max-class chips and about 36 tok/s on an M1 Pro. That puts a typical prediction at roughly 0.5–2 s without speculative decoding: usable but slower than hosted. Sweep Next-Edit 1.5B (Apache-2.0) claims under 500 ms on a laptop with speculative decoding. Plain FIM with Qwen2.5-Coder 1.5B/3B/7B through llama.cpp's `--fim-qwen-*-default` presets is the cheap baseline. ([Zeta 2.1 card](https://huggingface.co/zed-industries/zeta-2.1), [llama.cpp Apple Silicon bench](https://github.com/ggml-org/llama.cpp/discussions/4167), [Sweep card](https://huggingface.co/sweepai/sweep-next-edit-1.5B))
- **Inline chat through a harness is feasible.** Codex app-server's `thread/start` accepts `ephemeral`, `sandbox`, `baseInstructions`/`developerInstructions`, `model`, and `serviceTier`, and `turn/start` accepts an `outputSchema`. Claude Code's `-p` mode has `--json-schema`, `--tools`, `--system-prompt`, and `--no-session-persistence`. Either can return a schema-validated patch for a selection. For Claude subscriptions the harness is the *only* sanctioned path. Zed itself keeps External Agents out of the Inline Assistant, though. ([Codex protocol](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L62-L115), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference))
- **Recommendation: split the providers.** Use an `EditPredictor` trait for tab completion: local Zeta/FIM over an OpenAI-compatible `/v1/completions` endpoint first, hosted FIM APIs optional. Use a separate `InlineEditor` trait for inline chat with two backends: a direct LLM backend (ChatGPT-subscription Responses, API keys) and a harness backend (Codex app-server or Claude Code `-p` with a structured-output schema).

## 1. How ChatGPT sign-in works technically (Zed's implementation)

Zed added the provider in the `openai_subscribed` crate, surfaced as provider id `openai-subscribed` with the name "ChatGPT Subscription" ([source L31-L33](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L31-L33)). The feature was announced on 2026-05-15 ([Zed blog](https://zed.dev/blog/chatgpt-subscription-in-zed)).

**OAuth flow** ([`do_oauth_flow`, L1037-L1096](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L1037-L1096)):
- Authorization-code flow with PKCE (S256), a random `state`, and a browser redirect.
- Authorize URL: `https://auth.openai.com/oauth/authorize`. Token URL: `https://auth.openai.com/oauth/token` ([L36-L37](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L36-L37)).
- `client_id = app_EMoamEEZ73f0CkXaXp7hrann` ([L38](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L38)). This is exactly the Codex CLI's `CLIENT_ID` ([codex `login/src/auth/manager.rs` L1717](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/login/src/auth/manager.rs#L1717)). **Zed has no OAuth client of its own; it borrows Codex's.**
- As a consequence, the redirect URI must be `http://localhost:1455/auth/callback`, falling back to port 1457. Zed's comment says any other host, port, or path is rejected with `unknown_error` because the Codex client's redirect allow-list is fixed ([L1037-L1046](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L1037-L1046)). Codex uses the same ports ([codex `login/src/server.rs` L77-L79](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/login/src/server.rs#L77-L79)). Practical consequence: Polaris's sign-in would collide with a concurrent `codex login` on the same ports.
- Extra authorize params copied from Codex: `id_token_add_organizations=true` and `codex_cli_simplified_flow=true`. Zed sends `originator=zed` ([Zed L1089-L1096](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L1089-L1096); compare [Codex L592-L605](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/login/src/server.rs#L592-L605)).
- Scopes: Zed requests `openid profile email offline_access`. Codex additionally requests `api.connectors.read api.connectors.invoke`, which Zed drops to keep the JWT under Windows Credential Manager's 2560-byte limit ([Zed L1084-L1089](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L1084-L1089)).
- Credentials hold the access token, refresh token, expiry, `account_id`, and email. They live in the OS keychain under the key `https://chatgpt.com/backend-api/codex` and are refreshed 5 minutes before expiry ([L40-L56](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L40-L56)). The account ID is read from the id-token claim `https://api.openai.com/auth` ([L1230-L1260](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L1230-L1260)).

**Inference endpoint** ([L522-L570](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L522-L570)):
- Base URL `https://chatgpt.com/backend-api/codex`. Requests go to `/responses` as OpenAI **Responses API** payloads with `store=false`.
- Headers: `originator: zed`, `openai-beta: responses=experimental`, `chatgpt-account-id`, plus `session-id`/`thread-id` set to the prompt-cache key.
- The "Fast" `priority` service tier is supported on most models (`supports_priority`).
- Codex decides whether an originator is first-party with a hardcoded list: `codex_cli_rs`, `codex-tui`, `codex_vscode`, and anything starting with `Codex ` ([codex `default_client.rs` L141-L150](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/login/src/auth/default_client.rs#L141-L150)). `zed` is not on it, so OpenAI can identify and meter third-party traffic by originator.

**Models granted.** Zed asks the account-scoped catalog at `GET https://chatgpt.com/backend-api/codex/models?client_version=0.999.0` with a 5 s timeout. The `0.999.0` value is chosen to pass every model's `minimal_client_version` gate ([L42-L47](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L42-L47)). If that fails it falls back to gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4, and gpt-5.4-mini ([L431-L439](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L431-L439)). The "default fast model" is `gpt-5.6-luna` ([L220-L224](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/openai_subscribed/src/openai_subscribed.rs#L220-L224)). Codex's bundled catalog today lists gpt-6-astra, gpt-6-sol, gpt-6-luna, and gpt-5.6-*, all with a 272k context window. Every one is a reasoning model whose lowest effort is `low`, and none offers a non-reasoning mode ([models.json](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/models-manager/models.json)).

**Usage limits.** Usage is the same as in Codex and "determined by your tier" ([Zed blog](https://zed.dev/blog/chatgpt-subscription-in-zed)). Zed's docs say it is separate from OpenAI API billing ([use-an-existing-subscription.md](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/use-an-existing-subscription.md?plain=1#L23-L25)).

## 2. Viability: tab completion vs inline chat

| | Tab completion / edit prediction | Inline chat (targeted edits) |
|---|---|---|
| Needs | Under ~300–500 ms, fired on every keystroke pause, FIM or next-edit prompt format, a raw `/completions`-style endpoint, cheap high volume | 1–10 s is fine, instruction following, bounded output |
| ChatGPT subscription | **No.** The only endpoint is Responses with reasoning models, and there is no FIM or raw-prompt endpoint ([catalog](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/models-manager/models.json)). Per-keystroke volume would burn the Codex usage budget, and firing a request every keystroke looks like the "programmatic extraction" the ToU forbids. Zed doesn't offer it either ([EditPredictionProvider](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/settings_content/src/language.rs#L93-L101)). | **Yes.** Zed's Inline Assistant uses any configured LLM provider, "including … supported subscriptions" ([inline-assistant.md L24](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/inline-assistant.md?plain=1#L24)). Use the "fast" model (gpt-5.6-luna), `low` effort, and the priority tier. |

Zed's edit-prediction subsystem never touches its LLM-provider registry: no file in `crates/edit_prediction*` references `LanguageModelRegistry` or `openai_subscribed` (checked at the pinned SHA). Zed's own debounce defaults show the latency budget: Copilot 75 ms, Codestral 150 ms, Zeta/Mercury/Ollama 0 ms ([edit-prediction.md](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/edit-prediction.md?plain=1#L164-L173)).

## 3. Terms and risk

- **OpenAI Terms of Use** (ROW/EU) prohibit users from "automatically or programmatically extract[ing] data or Output" and from "circumventing any rate limits or restrictions or bypassing any protective measures" ([ROW ToU](https://openai.com/policies/row-terms-of-use/), [EU ToU](https://openai.com/en-GB/policies/eu-terms-of-use/)). *Caveat: openai.com returned 403 to automated fetches. The quoted wording is from search-indexed text of those pages. Verify in a browser before relying on the exact wording.*
- **OpenAI's documentation mentions only first-party surfaces** for "Sign in with ChatGPT": the ChatGPT desktop app, Codex CLI, and IDE extension ([Codex auth docs](https://learn.chatgpt.com/docs/auth)). Nothing documents third-party use of the Codex client ID or the `backend-api/codex` endpoint.
- **In practice.** Zed shipped the integration publicly on 2026-05-15, saying "We're excited to work with OpenAI" and "OpenAI continues to support subscription-based access for third-party tools" ([Zed blog](https://zed.dev/blog/chatgpt-subscription-in-zed)). OpenCode-style plugins do the same thing ([numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth)). The contrast is Anthropic: Zed's docs route Claude subscriptions *only* through the Claude Code / Claude Agent harness ("No direct Zed LLM provider path") ([use-an-existing-subscription.md](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/use-an-existing-subscription.md?plain=1#L16)).
- **Risk for Polaris (personal use).** Low for inline chat at human request rates. Main exposures:
  1. OpenAI can revoke access at any time, because it is an undocumented endpoint and identifiable by originator.
  2. The borrowed client ID and redirect ports are fixed, so Polaris would have to impersonate Codex's OAuth client just as Zed does.
  3. Model slugs and `minimal_client_version` gating change without notice.
  
  Do not use it for completion. The safest subscription path is to drive the real `codex` binary (see §5), because then Polaris never holds tokens or claims to be Codex.

## 4. Local model options for tab completion (Apple Silicon)

**Models**

| Model | Size / base | License | Type | Notes |
|---|---|---|---|---|
| [zed-industries/zeta-2.1](https://huggingface.co/zed-industries/zeta-2.1) | 8B, Seed-Coder-8B-Base | Apache-2.0 | next-edit (rewrites editable regions using edit history) | SPM prompt with multi-region markers. 26 quantized variants (llama.cpp/Ollama/LM Studio). Zed prompt format `zeta2_1` |
| [zed-industries/zeta-2](https://huggingface.co/zed-industries/zeta-2) | 8B, Seed-Coder-8B-Base | Apache-2.0 | next-edit | Trained on about 100k opt-in examples, "30% better [acceptance] than Zeta1" ([blog](https://zed.dev/blog/zeta2)) |
| [zed-industries/zeta](https://huggingface.co/zed-industries/zeta) | ~8B, Qwen2.5-Coder-7B | Apache-2.0 | next-edit (v1) | The card recommends vLLM with FP8, prefix caching, and n-gram speculative decoding, because most output tokens are copied from the prompt |
| [sweepai/sweep-next-edit-1.5B](https://huggingface.co/sweepai/sweep-next-edit-1.5B) | 1.5B, Qwen2.5-Coder | Apache-2.0 | next-edit | Q8_0 GGUF is 1.54 GB, 8k context. Claims "under 500ms (with speculative decoding)" on a laptop. Zed format `sweep` |
| Qwen2.5-Coder 0.5B/1.5B/3B/7B | [card](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B) | Apache-2.0 | classic FIM (`<\|fim_prefix\|>…`) | llama.cpp presets `--fim-qwen-{1.5b,3b,7b,30b}-default` sized for under 8 GB, under 16 GB, 16 GB+, and 64 GB+ ([llama.vscode](https://github.com/ggml-org/llama.vscode)) |

**Throughput on Apple Silicon.** These are llama.cpp numbers for LLaMA-7B Q4_0, a proxy for 7–8B coder models ([llama.cpp discussion #4167](https://github.com/ggml-org/llama.cpp/discussions/4167)):

| Chip | Prompt processing (tok/s) | Generation (tok/s) |
|---|---|---|
| M1 Pro 16c | 266 | 36 |
| M2 Max 38c | 671 | 66 |
| M3 Max 40c | 760 | 66 |
| M4 Max 40c | 886 | 83 |
| M5 Max 40c | 987 | 103 |

**Measured end to end.** llama.vim on an M1 Pro running Qwen2.5-Coder **1.5B** Q8_0: 1245 ms for a suggestion with 260 new prompt tokens and 24 generated tokens ([llama.vim README](https://github.com/ggml-org/llama.vim)).

**Estimate** (derived from the table above, not measured). Zeta 2.x on an M4 Max at Q4, with a warm prefix cache and about 60–120 output tokens for a region rewrite, lands around 0.7–1.5 s before speculative decoding. On an M1 Pro it is 2–3x that. The prompt is large: Zed's cursor excerpt budget alone is 8192 tokens ([cursor_excerpt.rs L5](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/edit_prediction/src/cursor_excerpt.rs#L5)). Uncached prompt processing costs seconds, so prefix/KV caching and n-gram speculation are mandatory, not optional. A 1.5B model is roughly 4–5x faster and is the realistic "feels instant" option on non-Max machines.

**Serving**
- **llama.cpp `llama-server`**: Metal, OpenAI-compatible `/v1/completions`, FIM presets, prompt caching. The most mature choice.
- **Ollama**: a first-class provider in Zed. Setting `"model": "zeta2"` or `"zeta2.1"` triggers automatic prompt-format inference ([edit-prediction.md L321-L410](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/edit-prediction.md?plain=1#L321-L410)).
- **MLX (`mlx_lm.server`)**: implements `/v1/completions` and `/v1/chat/completions` ([server.py](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py)) but is "not recommended for production" and serializes requests when `--kv-bits` is set ([SERVER.md](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md)).
- **vLLM/SGLang**: recommended on the Zeta cards but aimed at CUDA, so not a macOS fit.

**Hosted FIM fallbacks** that Zed already integrates: Copilot, Codestral, and Mercury Coder ([edit-prediction.md L234-L320](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/edit-prediction.md?plain=1#L234-L320)). Copilot is the only one that uses a *subscription* (device-code sign-in).

## 5. Inline chat through a harness (Codex / Claude Code)

It is feasible, with caveats.

**Codex app-server (JSON-RPC)**
- `thread/start` accepts `model`, `serviceTier`, `cwd`, `approvalPolicy`, `sandbox`, `baseInstructions`, `developerInstructions`, `config`, and `ephemeral` ([thread.rs L62-L115](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L62-L115)).
- `turn/start` accepts `effort` and an `outputSchema` ([turn.rs L258](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L258)).
- Pattern: keep one long-lived `codex app-server` process. For each inline request, start an ephemeral thread with a read-only sandbox and never-approve, replace the base instructions with an "edit this range, return JSON" prompt, pass the selection plus context as input, and require `outputSchema = {replacement: string}` (or a list of hunks). Polaris applies the result as a normal buffer edit, which keeps undo and diff-preview.
- Benefits: Codex owns auth, refresh, and the ChatGPT usage accounting. Polaris never sees tokens and makes no originator claims.

**Claude Code**
- `claude -p --output-format stream-json --json-schema <schema> --tools "" --system-prompt <prompt> --model haiku|sonnet --no-session-persistence --max-turns 1` gives a single-shot, tool-less, schema-validated edit ([CLI reference](https://code.claude.com/docs/en/cli-reference)).
- `--input-format stream-json` allows a warm process that accepts several requests.
- This is the only subscription-backed path for Claude. Zed's docs likewise route Claude Pro/Max only through Claude Code / Claude Agent ([use-an-existing-subscription.md](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/use-an-existing-subscription.md?plain=1#L27-L33)).

**Caveats**
- **Harness overhead.** Each harness adds its own system prompt, tool schemas, and session machinery, which cost latency and tokens. Mitigate with a warm process, replaced base instructions, disabled tools, and a small or fast model. I didn't measure this latency; it needs a spike.
- **Zed doesn't do this.** External Agents "are not available for Inline Assistant generations" ([inline-assistant.md L24](https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076/docs/src/ai/inline-assistant.md?plain=1#L24)), so Polaris would be going beyond Zed's precedent.
- **Streaming.** A harness streams agent events, not a token-level diff of the selection. With a JSON-schema result you get the edit only at the end, so there is no progressive in-place rewrite as in Zed. Alternative: let the agent use its own edit tool on the file and watch the file change. That makes behavior less predictable (it may touch other lines).

## 6. Recommended provider abstraction for Polaris

```text
trait EditPredictor            // tab completion; latency-critical, high-volume
  predict(ctx: PredictionContext /* excerpt, cursor, recent edits, diagnostics */) -> Stream<Edit>
  impls: OpenAiCompatibleCompletions { url, model, prompt_format: Zeta2_1 | Sweep | QwenFim | ... }
         // local llama-server / Ollama / mlx_lm.server; hosted Codestral/Mercury also fit here
         Copilot (optional; subscription via device-code)

trait InlineEditor             // inline chat; human-rate, instruction-following
  edit(selection, instruction, context) -> Stream<EditProgress> + Final<Vec<Hunk>>
  impls: DirectLlm(LlmBackend)                 // raw model API, token streaming
           LlmBackend = OpenAiResponses { auth: ApiKey | ChatGptSubscription }
                      | Anthropic { ApiKey } | OpenAiCompatible { local }
         Harness(HarnessBackend)               // structured-output, harness owns auth
           HarnessBackend = CodexAppServer | ClaudeCodePrint
```

- Keep the two traits separate: they share no prompt format, endpoint shape, or latency budget. Zed keeps them separate for the same reason: its edit prediction never touches its LLM-provider registry.
- Implement the prompt formats (`zeta2_1`, `sweep`, `qwen` FIM) as pure functions. Zed's `zeta_prompt` crate is the reference ([crates/zeta_prompt](https://github.com/zed-industries/zed/tree/e683fd7b465ecfb42b1da88ff685d204c2781076/crates/zeta_prompt)). Zed is GPL/AGPL, so reimplement rather than copy.
- Prefer `Harness(CodexAppServer)` over `DirectLlm(ChatGptSubscription)` as the default subscription path. Offer the direct path only as an opt-in "faster, unofficial" toggle.

## Open questions

1. What is the real latency of a warm Codex app-server or `claude -p` single-shot inline edit (TTFT and total) compared with a direct Responses call? This needs a spike.
2. Measured Zeta 2.1 Q4/Q8 vs Sweep 1.5B latency and acceptance on the user's actual Mac, with llama.cpp prompt cache and `--lookup`/n-gram speculative decoding.
3. Does any Ollama or official GGUF Zeta 2.1 build ship tokenizer special tokens that llama.cpp handles correctly (SPM markers)? The HF card lists quants but no validation.
4. Will OpenAI publish an official third-party "Sign in with ChatGPT" OAuth client program? That would remove the need to borrow Codex's client ID.
5. Exact current ToU wording: openai.com blocked automated fetches, so confirm §3 quotes manually.
