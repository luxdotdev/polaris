# Harness integration surfaces: what a UI can drive

Research for Linear ENG-171 ("what Claude Code, Codex, and ACP expose to drive a Harness from a UI"). Researched 2026-09-27 against primary sources only. Source pins:

- `openai/codex` @ [`32f5784`](https://github.com/openai/codex/tree/32f578485143354d1c321840a3e990aabdbaca9c)
- `agentclientprotocol/agent-client-protocol` @ [`15219ed`](https://github.com/agentclientprotocol/agent-client-protocol/tree/15219ed70b6cfc19a0951b2a7e9272ed1d23640f) (schema 1.9.1)
- `zed-industries/claude-code-acp` (npm `@agentclientprotocol/claude-agent-acp`) @ [`e6681d2`](https://github.com/zed-industries/claude-code-acp/tree/e6681d2a5734857727352474c8c9aa848f9210ee)
- `agentclientprotocol/codex-acp` @ [`bf37821`](https://github.com/agentclientprotocol/codex-acp/tree/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9). The old `zed-industries/codex-acp` [says development moved there](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/README.md).
- Claude Code docs at code.claude.com as of the same date

Short link aliases used below:

- `[codex-common]`: https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/common.rs
- `[cc-acp]`: https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/acp-agent.ts

## TL;DR

1. **Codex `app-server` is the most complete surface, and it's the one that lets a UI and the native TUI share one live session.** It is a JSON-RPC server with thread start/resume/fork, turn start/steer/interrupt, streamed item deltas, an aggregated `turn/diff/updated`, server-initiated approval requests, and image inputs. It listens on stdio, a unix socket, or ws. `codex --remote unix://PATH` attaches the stock TUI to that same server. `thread/resume` on a running thread "rejoins" it, so several clients can be subscribed at once. ([docs](https://learn.chatgpt.com/docs/app-server), [cli](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/cli/src/main.rs#L944-L956), [resume semantics](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L340-L353))
2. **The Claude Agent SDK covers every UI capability, but no two processes can have one Claude session open at once.** It is TS/Python only; it spawns the `claude` binary. It does streaming (`includePartialMessages`), `canUseTool` approvals, `interrupt()`, images, resume/fork. The docs say "Two processes can't write to the same transcript" ([agent-view](https://code.claude.com/docs/en/agent-view)). Terminal handoff for Claude is therefore **sequential**: close the SDK query, then run `claude --resume <sessionId>` in a PTY. The SDK writes the same `~/.claude/projects/*.jsonl` store the CLI reads ([sessions](https://code.claude.com/docs/en/agent-sdk/sessions)).
3. **Claude Code hooks are the observation and approval channel while the user is in the native Claude TUI.** HTTP hooks POST every lifecycle event to a URL (the Daemon). `PermissionRequest` and `PreToolUse` hooks can answer allow/deny with a 600 s default timeout. They cannot start turns, stream tokens, or interrupt ([hooks](https://code.claude.com/docs/en/hooks)).
4. **Claude Code Remote Control is not an integration surface.** It is a first-party pairing between a local `claude` and claude.ai/code or the Claude mobile app, relayed through the Anthropic API. It is subscription-only and has no documented third-party client protocol ([remote-control](https://code.claude.com/docs/en/remote-control)). Polaris cannot use it as a transport.
5. **ACP is the de facto common abstraction, and Zed (GPUI, Rust) is the reference client.** It has maintained adapters for both Harnesses: `claude-agent-acp` wraps the Agent SDK, and `codex-acp` wraps a private `codex app-server` over stdio. Both advertise images, permission requests, diffs, `session/load` + resume + fork, and cancel. The ACP session id *is* the Claude session id or Codex thread id, so a native `--resume` works after the adapter lets go ([cc-acp L8209-8225](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/acp-agent.ts#L8209-L8225), [codex-acp](https://github.com/agentclientprotocol/codex-acp/blob/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9/src/CodexAcpClient.ts#L683)).
6. **ACP is lossy.** It has no aggregated turn diff and no steer-mid-turn (Claude's adapter has a `promptQueueing` meta flag instead). It also hides the shared app-server, because codex-acp spawns its own stdio app-server, so the live TUI co-attach from (1) is impossible through ACP.
7. **Subscription auth works on every local surface, as long as Polaris drives the user's own unmodified binary and never touches the credentials.** Codex: ChatGPT sign-in gives "subscription access" in the CLI/IDE, and app-server exposes `account/login/start {type:"chatgpt"}` ([auth](https://learn.chatgpt.com/docs/auth)). Claude: the terms bar third-party developers from *offering* claude.ai login or routing requests through Pro/Max credentials "on behalf of their users", and from collecting or storing tokens. They explicitly do not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". The Pro/Max limits "assume ordinary, individual usage of Claude Code and the Agent SDK" ([legal](https://code.claude.com/docs/en/legal-and-compliance)). A personal Polaris is fine. A distributed Polaris must keep sign-in inside the `claude` binary's own flow; see the Open questions.
8. **Recommendation:** define Polaris's own `Harness` trait with ACP's shape. Implement it with a Codex **app-server-native** driver (keeps co-attach, steer, turn diff) and a Claude driver over **claude-agent-acp**. The second option for Claude is a small TS sidecar on the Agent SDK. Add Claude hooks for when the user takes over in the terminal. Don't build on Remote Control.

## Capability matrix

Legend: ✅ supported and documented · ⚠️ partial or with caveats · ❌ not available

| Capability | Claude Agent SDK | Claude Code hooks | Claude Remote Control | Codex app-server | ACP + claude-agent-acp | ACP + codex-acp |
|---|---|---|---|---|---|---|
| Start session | ✅ `query()` | ❌ (observe `SessionStart` only) | ❌ for 3rd parties | ✅ `thread/start` | ✅ `session/new` | ✅ `session/new` |
| Resume / fork | ✅ `resume`, `forkSession` | ❌ | n/a | ✅ `thread/resume`, `thread/fork` | ✅ `loadSession`, `resume`, `fork` | ✅ `loadSession`, `resume`, fork |
| Stream text + tool calls | ✅ `stream_event` partials | ⚠️ tool events only, no token stream | n/a | ✅ `item/*` deltas | ✅ `session/update` | ✅ `session/update` |
| Show diffs | ⚠️ derive from Edit/Write tool inputs; `rewindFiles` checkpoints | ⚠️ `PostToolUse` tool input | n/a | ✅ `turn/diff/updated` (aggregate unified diff) + `item/fileChange/*` | ✅ per-tool-call `diff` content ("Edit review") | ✅ per-tool-call diff |
| Answer permission prompts | ✅ `canUseTool` (+ `AskUserQuestion`) | ✅ `PermissionRequest`/`PreToolUse` decision | n/a | ✅ `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput` | ✅ `session/request_permission` | ✅ `session/request_permission` |
| Interrupt | ✅ `interrupt()` (streaming-input mode) | ❌ | n/a | ✅ `turn/interrupt` | ✅ `session/cancel` | ✅ `session/cancel` |
| Steer mid-turn | ⚠️ queued messages via `streamInput` | ❌ | n/a | ✅ `turn/steer` | ⚠️ `_meta.claudeCode.promptQueueing` | ⚠️ not in ACP core |
| Attach images | ✅ base64 image blocks | ❌ | (first-party only) | ✅ `image` URL / `localImage` path | ✅ `promptCapabilities.image` | ✅ `promptCapabilities.image` |
| Native TUI on same session, **concurrently** | ❌ one process per transcript | ✅ hooks fire inside the TUI | ✅ but only claude.ai/mobile as the other end | ✅ `codex --remote unix://…` + multi-subscriber threads | ❌ | ❌ (private stdio app-server) |
| Native TUI on same session, **sequentially** | ✅ `claude --resume <id>` | n/a | n/a | ✅ `codex resume <id>` | ✅ (ACP id = Claude session id) | ✅ (ACP id = thread id) |
| Language for Polaris (Rust) | ⚠️ needs Node/Python sidecar, or raw `claude -p --input-format stream-json` | ✅ HTTP endpoint in Daemon | ❌ | ✅ JSON-RPC; TS/JSON schema generated from Rust types | ✅ Rust ACP crate (Zed uses it) | ✅ |

Sources per column:

- **Agent SDK:** [overview](https://code.claude.com/docs/en/agent-sdk/overview), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output) (`includePartialMessages` yields `stream_event`), [user input](https://code.claude.com/docs/en/agent-sdk/user-input) (`canUseTool` fires for both permission and `AskUserQuestion`), [streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) (image uploads, queued messages, interruption), [TS reference](https://code.claude.com/docs/en/agent-sdk/typescript) (`interrupt()` only in streaming input mode; `rewindFiles`, `setPermissionMode`, `setModel`). Non-TS/Python callers are told to "run the CLI as a subprocess" with `-p` ([overview](https://code.claude.com/docs/en/agent-sdk/overview), [headless](https://code.claude.com/docs/en/headless): `--input-format stream-json`, `--include-partial-messages`, `--permission-prompt-tool`).
- **Hooks:** [hooks reference](https://code.claude.com/docs/en/hooks). The event list includes `PreToolUse` ("Can block it"), `PermissionRequest`, `PostToolUse`, `Notification`, `Stop`, `SessionStart`/`SessionEnd`. `type: "http"` POSTs the event JSON to a URL, and the default timeout is 600 s for command/http. Hooks fire "wherever it runs: sessions in the terminal, IDE extensions, the Desktop app, and cloud sessions". A `PermissionRequest` hook in a session that can't prompt decides the call; with no decision, the call is denied.
- **Remote Control:** [remote-control](https://code.claude.com/docs/en/remote-control). It connects "claude.ai/code or the Claude app" to a local session. Traffic goes "through the Anthropic API"; the session "registers with the Anthropic API and polls for work". Requirements: Pro/Max/Team/Enterprise, "API keys are not supported". A `setup-token` OAuth token "can't establish Remote Control sessions" ([authentication](https://code.claude.com/docs/en/authentication)).
- **Codex app-server:** method table in [`[codex-common]`](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/common.rs#L551-L579): `thread/start` L551, `thread/resume` L557, `thread/fork` L563, `thread/unsubscribe` L579, `turn/start` L1032, `turn/steer` L1044, `turn/interrupt` L1050, approvals L1765-L1790, `turn/diff/updated` L1948, `item/agentMessage/delta` L1960. `UserInput` variants `Text`, `Image`, `LocalImage`, `Audio`, `Skill`, `Mention` are in [turn.rs L425-L455](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L425-L455). The official [app-server docs](https://learn.chatgpt.com/docs/app-server) list approval decisions `accept`, `decline`, `cancel`, `acceptForSession`. `turn/diff/updated` gives "latest aggregated unified diff across every file change". Websocket is "experimental and unsupported", and experimental methods need `capabilities.experimentalApi: true`.
- **ACP:** [v1 meta.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v1/meta.json) method list (`session/new|load|resume|prompt|cancel|list|close`, client-side `session/request_permission`, `session/update`, `fs/*`, `terminal/*`). The [tool-call diff content](https://agentclientprotocol.com/protocol/v1/tool-calls) and [image content](https://agentclientprotocol.com/protocol/v1/content) pages cover diffs and images. [`session/load`](https://agentclientprotocol.com/protocol/v1/session-setup) enables "sharing sessions between different Client instances" by history replay.
- **claude-agent-acp:** [README](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/README.md) lists images, tool calls with permission requests, edit review, TODOs, subagent transcripts, and slash commands. Its [initialize response](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/acp-agent.ts#L2320-L2366) has `promptCapabilities.image`, `loadSession`, resume/fork/list/close, and `promptQueueing`.
- **codex-acp:** [README](https://github.com/agentclientprotocol/codex-acp/blob/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9/README.md) says it "starts the Codex App Server, translates ACP requests into Codex operations". Its [spawn code](https://github.com/agentclientprotocol/codex-acp/blob/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9/src/CodexJsonRpcConnection.ts#L21-L25) runs `codex app-server` as a private child over stdio, and its [capabilities](https://github.com/agentclientprotocol/codex-acp/blob/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9/src/CodexAcpServer.ts#L372-L396) include `loadSession`, `resume`, and `image`.

## Auth and billing per surface

| Surface | Subscription (Claude Pro/Max, ChatGPT plan) | API billing | What the terms say |
|---|---|---|---|
| Claude Agent SDK | ⚠️ Technically yes: the SDK is a listed login path, and it runs the `claude` binary, which reads the stored `/login` or `CLAUDE_CODE_OAUTH_TOKEN` ([authentication](https://code.claude.com/docs/en/authentication)) | ✅ `ANTHROPIC_API_KEY` (the documented path) | "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" ([overview](https://code.claude.com/docs/en/agent-sdk/overview)). Developers "should use API key authentication", and may not "route requests through Free, Pro, or Max plan credentials on behalf of their users" or "collect, store, or intermediate Claude.ai credentials". But this "does not ... prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription", and "advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK" ([legal](https://code.claude.com/docs/en/legal-and-compliance)). |
| Claude `claude -p` headless | ✅ Uses the stored login; `setup-token` makes a one-year subscription token for scripts (bare mode excluded) | ✅ | Same as above. Pro/Max OAuth falls under the [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) ([legal](https://code.claude.com/docs/en/legal-and-compliance)). |
| Claude hooks | n/a (they run inside whatever auth the session uses) | n/a | none |
| Claude Remote Control | ✅ **only** subscription | ❌ "API keys are not supported" | first-party only ([remote-control](https://code.claude.com/docs/en/remote-control)) |
| Codex app-server | ✅ `account/login/start` `{type:"chatgpt"}` / `chatgptDeviceCode` ([account.rs L64-L103](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L64-L103)). `chatgptAuthTokens` (client-supplied tokens) is marked "FOR OPENAI INTERNAL USE ONLY" | ✅ `apiKey` | "Sign in with ChatGPT for subscription access" vs API key for "usage-based access", with API key usage billed "at standard API rates". API keys are recommended "for programmatic Codex CLI workflows, such as CI/CD" ([auth](https://learn.chatgpt.com/docs/auth)). The app-server docs pitch it for "a deep integration inside your own product: authentication, conversation history, approvals" ([app-server](https://learn.chatgpt.com/docs/app-server)). There is no explicit statement on third-party clients using ChatGPT sign-in. An OpenAI engineer said forking is fine under Apache-2.0 but declined to rule on ToS ([discussion #8338](https://github.com/openai/codex/discussions/8338)). |
| claude-agent-acp | ✅ Offers "Claude Subscription" (`claude auth login --claudeai`, run as a terminal auth method) and "Anthropic Console (API usage billing)" ([cc-acp L2278-L2316](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/acp-agent.ts#L2278-L2316)). A `--hide-claude-auth` flag exists for integrations that "must never bill a claude.ai subscription" ([hide-claude-auth.ts](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/hide-claude-auth.ts#L1-L6)) | ✅ | Sign-in completes in Anthropic's own flow inside the `claude` binary, which is what the legal page requires |
| codex-acp | ✅ ChatGPT and device-code methods ([CodexAuthMethod.ts](https://github.com/agentclientprotocol/codex-acp/blob/bf37821e8f3c1f1e9b6954171855a9e2579cd2c9/src/CodexAuthMethod.ts#L28-L40)); the old adapter notes ChatGPT login "doesn't work in remote projects" ([old README](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/README.md)) | ✅ `CODEX_API_KEY`/`OPENAI_API_KEY` | as Codex |

What this means for Polaris: every local surface runs under the user's own subscription as long as Polaris (a) spawns the **unmodified** `claude`/`codex` binaries, (b) lets sign-in happen in the binary's own flow (`claude auth login`, `codex login`, or app-server `account/login/start`), and (c) never reads, stores, or forwards the OAuth tokens. Background sessions use subscription quota linearly: "running ten agents in parallel uses quota roughly ten times as fast" ([agent-view](https://code.claude.com/docs/en/agent-view)).

## Terminal handoff feasibility ("drop into the native TUI on the same session")

**Codex: live and concurrent. This is the best case.**

1. The Daemon runs one `codex app-server --listen unix://<path>` per Host (flag: [cli L564-L571](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/cli/src/main.rs#L564-L571)). Polaris is a JSON-RPC client on that socket.
2. For handoff, open a PTY in Polaris's terminal pane and run `codex resume <threadId> --remote unix://<path>`. `--remote` is accepted by `resume` ([cli L944-L956](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/cli/src/main.rs#L944-L956); a parse test for `codex resume --remote unix://codex.sock` is at L4347).
3. Because "If thread_id identifies a running thread, app-server rejoins that thread" ([thread.rs L349-L350](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L349-L350)), and threads track multiple subscribed connections (the thread unloads only when "the last subscriber" leaves, per [app-server docs](https://learn.chatgpt.com/docs/app-server)), the TUI and Polaris both see the same live events. Either one can answer approvals. The server emits `serverRequest/resolved` ([`[codex-common]`](https://github.com/openai/codex/blob/32f578485143354d1c321840a3e990aabdbaca9c/codex-rs/app-server-protocol/src/protocol/common.rs)) so the other client can dismiss its prompt.
4. The official docs describe the same pattern: "Remote terminal UI mode lets you run app-server on one machine and connect the Codex CLI terminal interface from another" ([app-server](https://learn.chatgpt.com/docs/app-server)). That also fits Polaris's remote-Host model.
5. Caveat: going through **codex-acp** loses all of this, because the adapter owns a private stdio app-server.

**Claude: sequential only. Workable.**

1. There is exactly one writer per transcript: "Two processes can't write to the same transcript" ([agent-view](https://code.claude.com/docs/en/agent-view#opening-a-session-says-the-conversation-is-already-open)).
2. Handoff means ending the SDK/ACP query (after interrupt or at turn end), then spawning `claude --resume <sessionId>` in a PTY. SDK sessions live in the same `~/.claude/projects/<encoded-cwd>/*.jsonl` store ([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)), and the ACP session id equals the Claude session id ([cc-acp L8209-L8225](https://github.com/zed-industries/claude-code-acp/blob/e6681d2a5734857727352474c8c9aa848f9210ee/src/acp-agent.ts#L8209-L8225)).
3. Handing back means the TUI exits, then Polaris does `session/load` (ACP) or SDK `resume`.
4. **While the user is in the TUI**, Polaris can still watch and co-approve through **HTTP hooks** pointed at the Daemon: `PreToolUse`/`PostToolUse`/`Stop`/`Notification` for status and `PermissionRequest` for remote approval. It can also poll `claude agents --json` for state such as `working|blocked|done` and `waitingFor: "permission prompt"`; the docs call that "the supported way to read session state from outside Claude Code" ([agent-view](https://code.claude.com/docs/en/agent-view#read-session-state-from-a-script)). What it can't do from outside is send a prompt or interrupt a TUI-owned session.
5. The nearest Claude analogue to Codex's co-attach is **agent view background sessions**. `claude --bg "<prompt>"` runs a session under a local supervisor; `claude attach <id>` gives the full TUI and detaches on `←`; `claude logs|stop|respawn <id>` manage it ([agent-view](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell)). There is no documented API to stream events from or send prompts to a background session, apart from a peer-messaging socket intended for Claude-to-Claude text ([cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)). So Polaris would get state plus attach, not a rich UI. The feature is also a "research preview".

## Sketch of the common abstraction

Model the internal trait on ACP, because two maintained adapters and Zed's GPUI client already prove the shape. Add optional capabilities for what Codex app-server does beyond it.

```rust
trait Harness {
    fn capabilities(&self) -> HarnessCaps; // images, steer, turn_diff, live_terminal_attach, fork
    async fn start(&self, cwd, opts) -> SessionId;          // ACP session/new | thread/start | query()
    async fn resume(&self, id) -> SessionHistory;           // session/load | thread/resume | resume
    async fn fork(&self, id) -> SessionId;                  // optional
    async fn prompt(&self, id, Vec<Content /* text | image | resource */>);
    async fn steer(&self, id, Vec<Content>);                // cap-gated: turn/steer; else queue
    async fn cancel(&self, id);                             // session/cancel | turn/interrupt | interrupt()
    fn events(&self, id) -> Stream<Event>;                  // below
    async fn release_for_terminal(&self, id) -> TerminalCommand; // see below
}

enum Event {
    MessageDelta{..}, ReasoningDelta{..},
    ToolCall{id, kind, status, title, diff: Option<FileDiff>, output},
    TurnDiff(UnifiedDiff),            // Codex native; else synthesized from ToolCall diffs
    Plan(Vec<PlanItem>),
    ApprovalRequest{req_id, kind: Exec|FileChange|Permissions|Question, options},
    ApprovalResolved{req_id},         // Codex serverRequest/resolved; hook-driven for Claude TUI
    TurnEnded{reason}, Usage{..}, ExternalTakeover{by: Terminal},
}
```

`release_for_terminal` returns different things per Harness:

- **Codex:** it returns `codex resume <id> --remote unix://…` and the session stays live in Polaris.
- **Claude:** it detaches the query and returns `claude --resume <id>`. Polaris then flips the Agent Session to "terminal-owned" and switches its event source to the hooks bridge until the PTY exits.

Driver choices:

- **Codex → app-server directly** over a Daemon-owned unix socket. This keeps co-attach, `turn/steer`, `turn/diff/updated`, and `serverRequest/resolved`. The protocol is generated from Rust types, and the schema ships in `app-server-protocol/schema`.
- **Claude → claude-agent-acp over stdio**, using the Rust ACP client like Zed does. It is the least code, and it already handles Agent SDK quirks like subagent transcripts, edit review, and auth methods. The alternative is a thin Polaris-owned TS sidecar on `@anthropic-ai/claude-agent-sdk`, if ACP's lossy spots (steer, custom events) matter later.
- **Claude TUI takeover → HTTP hooks** installed by Polaris (via `--settings` or project settings) that POST to the Daemon.

## Open questions

1. **Terms for a distributed Polaris on Claude subscriptions.** Driving the user's own unmodified `claude` with their own `/login` looks allowed; the legal page explicitly carves this out. Does wrapping it in the Agent SDK or claude-agent-acp inside a *product* count as "offering claude.ai login"? Zed ships exactly this. If Polaris stays personal it's a non-issue. If it ships, ask Anthropic ([contact sales link on legal page](https://code.claude.com/docs/en/legal-and-compliance)).
2. **OpenAI's position on third-party clients using ChatGPT sign-in through app-server** is unstated (see [#8338](https://github.com/openai/codex/discussions/8338)). The only explicit guidance is "API keys for programmatic/CI" ([auth](https://learn.chatgpt.com/docs/auth)).
3. **Codex co-attach needs a hands-on test.** Check that `codex resume --remote` against a thread that is mid-turn shows the in-flight turn, and that both clients get the approval request and the loser sees `serverRequest/resolved`. The code paths exist; the UX was not verified here.
4. **Stability.** app-server marks many methods experimental (`capabilities.experimentalApi`), and ws transport is "experimental and unsupported". ACP v2 (new prompt lifecycle, v1 fs/terminal removed) is "still labeled draft" ([migration](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/docs/protocol/v2/migration.mdx)). Pin versions and target ACP v1 for now (both adapters answer `protocolVersion: 1`).
5. **Claude hooks bridge details.** Can Polaris inject its hooks without touching the user's settings files (`--settings` on the resumed `claude`)? And how should a 600 s `PermissionRequest` hook timeout behave when the UI is closed?
6. **Remote Hosts.** codex-acp's old README says ChatGPT login "doesn't work in remote projects". Check whether app-server `chatgptDeviceCode` login on a headless Linux Host covers it.
