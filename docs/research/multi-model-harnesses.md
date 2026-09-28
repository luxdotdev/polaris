# Multi-model Harnesses: OpenCode, ACP and the rest

This is the research for Linear [ENG-197](https://linear.app/luxdev/issue/ENG-197): which Harnesses beyond Claude Code and Codex Polaris should drive, and through which surface, so users are not locked into Anthropic or OpenAI models. It was researched on 2026-09-28 against primary sources. Tags used below:

- **[src]** means read in source or in docs files.
- **[web]** means taken from issues or websites.
- **[inferred]** means our conclusion.

Source pins:

- `anomalyco/opencode` @ [`8d05153`](https://github.com/anomalyco/opencode/tree/8d05153965bee0a1e46eccffe944dc84d0b0c6f1) (v1.18.33). `sst/opencode` redirects here.
- `agentclientprotocol/agent-client-protocol`: schema v1.23.0 (2026-09-18) and TS SDK `@agentclientprotocol/sdk` 1.5.1.
- The ACP agent list at https://agentclientprotocol.com/overview/agents, read on the same date.

This builds on [harness-surfaces.md](harness-surfaces.md) (ENG-171), which covered Claude Code, Codex and ACP's Claude and Codex adapters.

## TL;DR

1. **OpenCode is MIT and built on Bun and Effect 4** (`4.0.0-beta.83`), so its stack is close to ours. It compiles to a single binary for x64 and arm64. [src]
2. **Drive it through `opencode serve`'s v1 HTTP + SSE API.** This is the only surface with all of the following:
   - per-message cost and tokens
   - a Model and reasoning effort (`variant`) for each message
   - provider and Model listing
   - child sessions, which become Subagents
   - fork and revert
   - live terminal attach (`opencode attach <url> -s <id>`), so In Terminal can be live co-attach, like Codex.

   One server serves many Workspaces, because the directory is sent with each request. [src]
3. **Neither of OpenCode's HTTP APIs is stable.** v1 is what the TUI and `@opencode-ai/sdk` use. An experimental v2 `/api/*` exists, but its clients are unpublished and its store has been reset several times. OpenCode ships weekly, and the SDK shares the app's version. Keep the driver thin and generate types from the server's `/doc` OpenAPI. [src]
4. **Memory is OpenCode's weak point.** A fresh `serve` process uses about 160 MB RSS. Issues report growth to about 1 GB over hours ([#51340](https://github.com/anomalyco/opencode/issues/51340)) and up to 2.2 GB for a resumed large session ([#50578](https://github.com/anomalyco/opencode/issues/50578)). Run one server per Host, started lazily and stopped when idle. [web]
5. **ACP v1 is stable and widely spoken, so a generic ACP driver is a worthwhile second tier.** It covers Gemini CLI, GitHub Copilot CLI, Cursor, Goose, Cline, Qwen Code, Kimi, Kiro and others at once. Fork, Model selection (session config options), provider listing and prompt usage are still unstable or optional, and ACP has no revert, no multi-client attach and no real Subagents. The driver must work from the features each Harness declares. [src/inferred]
6. **No candidate is GPL or AGPL.** Crush is FSL-1.1-MIT, so we can't copy its code yet, but we can drive it as a process. Amp is proprietary. [src]

## OpenCode surfaces

| Surface | What it is | Verdict |
|---|---|---|
| `opencode serve` (v1 routes) | HTTP on `127.0.0.1:4096`. The OpenAPI 3.1 spec is at `/doc`, and basic auth is set with `OPENCODE_SERVER_PASSWORD`. The TUI and `@opencode-ai/sdk` use it. | **Use this** |
| `opencode serve` (v2 `/api/*`) | An Effect `HttpApi` described as "Experimental HttpApi surface…" (v0.0.1). Its clients (`@opencode-ai/client`, `sdk-next`) are private. | Move to it once it's published |
| `opencode acp` | ACP v1 over stdio. Supports `loadSession`, session close/fork/list/resume, `setSessionMode`, `unstable_setSessionModel` and usage reporting. | A fallback only; it has no co-attach and no revert |
| `opencode run --format json` | One-shot runs with `--session`, `--fork`, `--model`, `--variant` and `--attach <url>`. | For scripts, not a driver |

### v1 HTTP in detail [src]

- **Creating a session:** `POST /session {parentID?, title?, agent?, model:{id,providerID,variant?}, permission?, metadata?}`.
  - Resuming means prompting the same session ID; sessions live in SQLite.
  - `GET /session/:id/message` and `/children` read state back.
- **Sending a Turn:**
  - `POST /session/:id/prompt_async` returns 204 and streams the result as events. `/prompt` blocks instead.
  - The body takes `parts` (text, file, agent, subtask), plus per message a `model:{providerID,modelID}`, `agent`, `variant`, `tools` and `system`.
- **Events:** subscribe to `GET /event` (per instance) or `GET /global/event`. Useful ones:
  - `message.updated`, `message.part.updated`, `message.part.delta`
  - `session.status`, `session.idle`, `session.error`, `session.diff`
  - `permission.asked`, `permission.replied`, `question.asked`
  - `file.edited`, `todo.updated`
- **Approvals:** a `permission.asked` event carries `{id, sessionID, permission, patterns, metadata, always[], tool}`. Answer with `POST /permission/:requestID/reply {reply: once|always|reject, message?}`. Rules can be set per session, in config, or through `OPENCODE_PERMISSION`.
- **Interrupting:** `POST /session/:id/abort`.
- **Models:** `GET /config/providers` lists the providers and their defaults; `/provider` and `/provider/auth` also exist. The Model is set when the session is created and can be overridden per message.
- **Subagents:** the `task` tool creates child sessions linked by `parentID`.
- **Fork, revert and undo:**
  - `POST /session/:id/fork {messageID?}`
  - `POST /session/:id/revert` restores files from git snapshots and returns 409 while the session is busy. `/unrevert` undoes it.
- **Usage:** every `AssistantMessage` carries `cost` (USD), `tokens {input, output, reasoning, cache{read,write}}`, `providerID` and `modelID`. Step-finish parts carry the same per step.
- **Workspaces:** instances are loaded from the `x-opencode-directory` header or `?directory=`, and `serve` creates none at startup.

### Credentials [src]

- Credentials are stored in `~/.local/share/opencode/auth.json`. They're set with `opencode auth login`, the TUI's `/connect` command, `PUT /auth/:id` or OAuth endpoints, or provider env vars.
- ChatGPT Plus/Pro (OAuth) and GitHub Copilot (device login) are supported.
- **Claude Pro/Max login was removed in 1.3.0.** The docs say "Anthropic explicitly prohibits this."
- OpenCode Zen is an optional hosted gateway that works like any other provider.

## ACP

**Stable v1 methods:**
- Setup: `initialize`, `authenticate`, `logout`
- Sessions: `session/new`, `session/load`, `session/list`, `session/resume`, `session/close`, `session/delete`
- Turns and settings: `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option`
- Client callbacks: `session/request_permission`, `fs/*`, `terminal/*`, elicitation
- `session/update` variants including `usage_update`, `plan` and `config_option_update`

**Unstable:**
- `session/fork`
- `providers/list` and `providers/set`
- `usage` in `PromptResponse`
- MCP-over-ACP

Model choice is moving to session config options with the "model" category. [src]

**ACP v2** is an in-progress RFD. It drops modes and client fs/terminal, and adds a new prompt lifecycle, resume replay and HTTP/WebSocket transports. Pin to v1. [src]

**Harness coverage** [web; Gemini CLI's `--acp` checked in source]:
- **Native:** OpenCode, Gemini CLI, GitHub Copilot CLI, Cursor, Goose, Cline, Kimi, Qwen Code, Kiro, Junie, Factory Droid, OpenHands, Mistral Vibe, Augment, Docker cagent, Qoder.
- **Through adapters:**
  - Claude Code via `agentclientprotocol/claude-agent-acp` (Apache-2.0)
  - Codex via `agentclientprotocol/codex-acp` (Apache-2.0)
  - Pi via `svkozak/pi-acp` (MIT)
- **Not yet:** Crush's ACP support is an open PR ([charmbracelet/crush#2450](https://github.com/charmbracelet/crush/pull/2450)). Amp only has community adapters.

**What ACP lacks for Polaris** [inferred]:
- no revert
- Subagents appear only as tool calls
- usage varies by agent
- resume replay isn't settled
- one stdio process per client, so no co-attach
- fork and Model setting are optional

## Other multi-model Harnesses

| Harness | Programmatic surface | Licence |
|---|---|---|
| Crush (Charm) | `crush run`, plus `crush server` over TCP or a Unix socket. No ACP upstream yet. | FSL-1.1-MIT: don't copy its code |
| Goose | ACP-native | Apache-2.0 |
| Pi | TS SDK, `--mode rpc` JSONL, `pi-acp` | MIT |
| Kilo Code | An OpenCode fork, with the same server shape | MIT |
| Cline CLI | `--acp` | Apache-2.0 |
| Gemini CLI | `--acp` | Apache-2.0 |
| Amp | `-x --stream-json`, `@ampcode/sdk` | Proprietary |
| Kimi | `MoonshotAI/kimi-code` (the Python CLI is archived) | MIT |

## Prior art

- **T3 Code** ([t3-code.md](t3-code.md)) drives OpenCode through `@opencode-ai/sdk`, with one server per thread because MCP registrations are scoped to a directory.
- Because `serve` loads instances per directory from each request, one server per Host should be enough. Confirm this with MCP servers registered in two Workspaces. [inferred]
