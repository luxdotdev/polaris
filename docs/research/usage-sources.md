# Usage and Plan Limit sources

This is the research for Linear [ENG-198](https://linear.app/luxdev/issue/ENG-198). The question is how the Daemon can give one view of token Usage, cost and subscription Plan Limits across Claude Code, Codex and OpenCode on every Host, using only what each Harness exposes or writes to disk. [ADR 0001](../adr/0001-polaris-never-touches-provider-credentials.md) forbids reading credentials. It was researched on 2026-09-28. Tags used below:

- **[src]** means read in source or in docs files.
- **[web]** means taken from websites.
- **[inferred]** means our conclusion.

Source pins:

- `steipete/CodexBar` @ `bd77ea6` (MIT)
- `ccusage/ccusage` @ `0dd85c1` (MIT)
- `pingdotgg/t3code` @ `ba79610` (MIT)
- `openai/codex` @ `33a0f76`
- `anomalyco/opencode` @ `8d05153` (MIT)
- `@anthropic-ai/claude-agent-sdk` 0.3.284

## TL;DR

1. **Every Harness exposes Plan Limits without Polaris touching credentials, except OpenCode.**
   - **Claude:** the Agent SDK's `rate_limit_event` messages, plus its experimental `get_usage`.
   - **Codex:** app-server `account/rateLimits/*`.
   - **OpenCode:** only reports a limit when a request is refused.
2. **CodexBar's easy paths are exactly what the ADR forbids.** It reads Claude Code's OAuth token from the Keychain or `~/.claude/.credentials.json` and calls `api.anthropic.com/api/oauth/usage`. It also decrypts browser cookies for claude.ai and chatgpt.com.
3. **Usage comes from the Harnesses' own logs.** The three log formats each have known traps, and ccusage (MIT) documents and handles all of them.
4. **Cost comes from Harness-reported values first (OpenCode), then from a price list.** Use LiteLLM for coverage (1-hour cache writes, pricing above 200k/272k tokens, priority and flex tiers), and models.dev as the fallback. Both are MIT.

## How CodexBar gets limits [src]

| Harness | Strategy | Allowed for Polaris? |
|---|---|---|
| Claude | Reads the OAuth token (Keychain `Claude Code-credentials` or `~/.claude/.credentials.json`), refreshes it itself, and calls `GET api.anthropic.com/api/oauth/usage` and `/profile` | No |
| Claude | Decrypts browser cookies, then calls `claude.ai/api/organizations/{org}/usage` and related endpoints | No |
| Claude | Runs `claude` in a PTY, sends `/usage` and `/status`, parses the screen, then deletes the probe's transcripts | Allowed, but fragile and wakes the Host |
| Claude | Admin API with an `sk-ant-admin` key the user supplies | Not relevant (org billing) |
| Codex | Reads `~/.codex/auth.json` and calls `chatgpt.com/backend-api/wham/usage` | No |
| Codex | Runs `codex app-server` and calls `account/read` and `account/rateLimits/read` | **Yes** |
| OpenCode | opencode.ai cookies, or the Go usage API with a key | No |

## What each Harness exposes itself

### Claude Code [src]

- **`SDKRateLimitEvent`**, streamed during a Turn:
  - `{type:'rate_limit_event', rate_limit_info:{status, resetsAt, rateLimitType, utilization, …}}`
  - `status` is one of `allowed | allowed_warning | rejected`.
  - `rateLimitType` is one of `five_hour | seven_day | seven_day_opus | seven_day_sonnet | seven_day_overage_included | overage`.
- **`query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`** (control request `get_usage`) returns:
  - `subscription_type`
  - `rate_limits` with the `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` and `model_scoped[]` windows, each with `utilization` (0–100) and `resets_at`
  - session cost and `model_usage`

  It needs a live query, so it can only be called while a Claude session is open.
- **`SDKUsageReport`:** the structured twin of `/usage`.
- **Statusline stdin JSON** ([docs](https://code.claude.com/docs/en/statusline)):
  - `rate_limits.five_hour`, `seven_day` and `spend_limit`, each with `used_percentage` and `resets_at` (epoch seconds). These appear only on Pro and Max, and only after the first API response.
  - It also carries `context_window.*` and `cost.total_cost_usd`.
  - A statusline in Polaris's own `--settings` file keeps limits updating while the user is In Terminal. [inferred]
- **Hooks** carry no rate-limit data. `StopFailure` only reports `rate_limit` as an error type.
- **Prior art:** T3 Code's `apps/server/src/provider/Layers/claudeUsageLimits.ts` merges `get_usage` with streamed `rate_limit_event`s.

### Codex [src]

These are in `app-server-protocol/src/protocol/common.rs` and `v2/account.rs`:

- **`account/rateLimits/read`** returns:
  - `rateLimits`: a `RateLimitSnapshot` with `primary` and `secondary` windows, each `{usedPercent, windowDurationMins, resetsAt}`, plus `credits`, `planType` and `rateLimitReachedType`.
  - `rateLimitsByLimitId`
  - `ordinaryUsageAllowed`
- **`account/rateLimits/updated`** is a sparse notification. Merge it into the last read.
- **`thread/tokenUsage/updated`** carries per-thread tokens.
- **Rollout JSONL:** an `event_msg` with `payload.type: "token_count"` carries `info{total_token_usage, last_token_usage, model_context_window}` and `rate_limits`. This is the offline fallback.
- **Prior art:** T3 Code's `codexUsageLimits.ts`.

### OpenCode [src]

- There is no proactive limit API.
- `packages/llm/src/route/executor.ts` parses the `x-ratelimit-*` and `anthropic-ratelimit-*` headers, but only onto errors.
- `session/retry.ts` tags retries as `account_rate_limit` or `free_tier_limit`, with `limitName` and `retry-after`.
- So OpenCode gives us "limit reached, resets in X" and nothing else.

## Where Usage lives on disk

**Claude Code** [src: ccusage `ccusage-config/src/config.rs`, CodexBar `docs/claude.md`]
- **Location:**
  - `$CLAUDE_CONFIG_DIR` (ccusage treats it as a comma-separated list)
  - else `~/.config/claude/projects` and `~/.claude/projects/**/*.jsonl`
- **Rows:** `type: "assistant"` lines with `message.usage`:
  - `input_tokens`, `output_tokens`
  - `cache_creation_input_tokens` (split into `ephemeral_5m` and `ephemeral_1h`, which are priced differently)
  - `cache_read_input_tokens`
- **Traps:**
  - Streaming writes repeated snapshots of one response. Dedup on `message.id` + `requestId`, with the last one winning, or on `sessionId` + `message.id` when there's no `requestId`.
  - Skip the `<synthetic>` model.
  - Watch for sidechain and copied records.

**Codex** [src: ccusage `adapters/codex/src/README.md`]
- **Location:** `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl` and `archived_sessions/`. If the same file is in both, the active copy wins.
- **Traps:**
  - `total_token_usage` is cumulative, and `last_token_usage` is the per-Turn delta. Where only totals exist, diff them.
  - `cached_input_tokens` is part of `input_tokens`, and `reasoning_output_tokens` is part of `output_tokens`.
  - The Model comes from `turn_context`.
  - Forks and Subagents replay the parent's history. Skip up to `task_started` or `inter_agent_communication(_metadata).trigger_turn`.
  - The service tier comes from `thread_settings_applied.service_tier`.

**OpenCode** [src: `packages/core/src/database/database.ts`, `session/sql.ts`]
- **Location:** `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` (or `opencode-<channel>.db`, or `$OPENCODE_DB`). Legacy JSON lives under `storage/message/`.
- **Tables:**
  - `message.data` (JSON) has `cost` and `tokens{input, output, reasoning, cache{read, write}}`.
  - `session` has aggregate columns.
- **Trap:** forks copy the parent's rows. Skip rows with `seq` at or below `fork_boundary`.

## Price lists [src]

| List | Licence | Coverage | Cadence |
|---|---|---|---|
| LiteLLM `model_prices_and_context_window.json` | MIT (outside `enterprise/`) | About 4.4k entries. Has per-token keys for cache read and creation, `_above_1hr`, `_above_200k_tokens` and `_above_272k_tokens`, `_priority`, `_flex` and `_batches`. | Several commits a day |
| models.dev (`anomalyco/models.dev`, `https://models.dev/api.json`) | MIT | `cost.{input, output, cache_read, cache_write}` per million tokens, plus `tiers[]`. Some Anthropic entries have no >200k tier and no 1-hour cache-write price. | Many commits a day |

ccusage now prices from models.dev. OpenCode uses it too.

## Code we may adapt

Adapting code from any of these is fine with attribution under AGENTS.md:
- ccusage (Rust)
- CodexBar (Swift)
- T3 Code (TS)
- OpenCode (TS)

The Claude Agent SDK is not open source. We depend on it, but don't copy from it.
