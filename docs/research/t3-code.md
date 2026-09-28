# T3 Code: server, client protocol, Harness drivers, and mobile access

Research for [ENG-170](https://linear.app/luxdev/issue/ENG-170) (map: [ENG-167](https://linear.app/luxdev/issue/ENG-167)).

- **Source read:** `pingdotgg/t3code` at commit `de251fc2971a884cb5b1305ba4daf309dc8cccb0` (2026-09-27). All links below are permalinks to that commit.
- **Repo:** https://github.com/pingdotgg/t3code. MIT, ~23.7k stars, created 2026-02-08 (GitHub API, `gh api repos/pingdotgg/t3code`).
- T3 Code's own words are used where they matter: *environment* (≈ Polaris **Host + Daemon**), *client*, *provider* / *driver* / *adapter* (≈ **Harness** integration), *thread* (≈ **Agent Session**, but longer-lived; see below).

## TL;DR

1. **One Node server per machine, thin clients.** An "environment" is one Node process (`npx t3` / `t3 serve`, also bundled in the Electron app) that owns providers, terminals, git, files and state. Web, desktop and a React Native mobile app are all clients of it over authenticated HTTP + WebSocket. This is the same shape as the Polaris "Daemon per Host" hypothesis. ([AGENTS.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/AGENTS.md), [docs/internals/overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md))
2. **The wire protocol is Effect RPC over one WebSocket (`/ws`), JSON-serialized,** with about 150 typed methods declared in one schema file ([packages/contracts/src/rpc.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/rpc.ts)). Orchestration exposes `dispatchCommand` plus two streaming subscriptions: `subscribeShell` for the sidebar and `subscribeThread` for one thread. The thread stream sends a snapshot and then sequenced events, resumable with `afterSequence`. HTTP carries auth, snapshots and dispatch as fallbacks ([environmentHttp.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/environmentHttp.ts)).
3. **The server is event-sourced in SQLite.** Commands go to a pure decider, which emits events into `orchestration_events`. Projections are updated in the same transaction and command receipts make retries idempotent. Reactors perform side effects afterwards ([001_OrchestrationEvents.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts), [overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md)).
4. **Harness drivers use each vendor's structured interface, never a PTY.** Claude Code runs through the **Claude Agent SDK** `query()` (streaming input, `canUseTool` for approvals, `resume`) and points `pathToClaudeCodeExecutable` at the user's own `claude`. Codex runs through **`codex app-server`** JSON-RPC over stdio, with the client generated from OpenAI's published protocol schemas. Cursor, Grok and Antigravity use **ACP**, and OpenCode uses its SDK/server. All of them normalize into one `ProviderRuntimeEvent` union ([ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Services/ProviderAdapter.ts)).
5. **Approvals** become `request.opened` / `request.resolved` runtime events. The client answers with a `thread.approval.respond` command, and the adapter completes a pending Deferred (Claude) or JSON-RPC server request (Codex). Four permission modes ("Supervised", "Auto-accept edits", "Auto", "Full access") are mapped onto each Harness's native policy.
6. **Diffs come from T3's own git checkpoints, not from the Harness.** After each turn it builds a tree through a temporary `GIT_INDEX_FILE`, then `write-tree`, `commit-tree` and `update-ref refs/t3/checkpoints/<thread>/turn/<n>`. That yields per-turn diffs and restore without touching the user's branch ([GitVcsDriver.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/vcs/GitVcsDriver.ts), [checkpointing/Utils.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/checkpointing/Utils.ts)).
7. **Remote access has four routes to the same server:** LAN pairing, Tailscale (`tailscale serve` HTTPS), desktop-managed SSH (installs or launches the server remotely and forwards the port), and **T3 Connect**. T3 Connect is a Cloudflare Worker relay (Clerk identity, PlanetScale via Hyperdrive) that provisions a **per-environment Cloudflare Tunnel**. The relay only brokers bootstrap credentials. **App traffic goes client → tunnel → environment and never through the relay** ([t3-connect.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/t3-connect.md), [infra/relay/README.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/README.md)).
8. **Auth is owned by the environment:** scoped sessions from one-time pairing links (secret carried in the URL *fragment*), cookie, bearer or **DPoP** tokens, short-lived WS tickets, and a required scope on every RPC ([environment-auth.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/environment-auth.md)).
9. **The mobile app is a serious React Native/Expo app with native modules** for diffs (Swift), terminal (libghostty), markdown and composer. It gets APNs/FCM push plus iOS Live Activities and widgets through the relay, which requires T3 Connect. Push does not work over plain LAN or Tailscale ([apps/mobile](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile), [mobile-notifications.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/user/mobile-notifications.md)).
10. **Licence:** the repo is MIT, so its ideas, schemas and algorithms can be referenced freely with attribution, and that is GPL-compatible. The code itself is TypeScript/Effect, so almost nothing ports into a Rust Daemon directly. The reusable parts are the **design**: the event model, the protocol shape, the checkpoint scheme, the relay trust model and the mobile UX patterns. The Claude Agent SDK dependency is **not** open source (`license: SEE LICENSE IN README.md`, from `npm view`).

## Architecture

```
                      ┌─────────────── T3 Connect (optional, hosted) ───────────────┐
                      │ Cloudflare Worker relay  (Clerk auth, PlanetScale/Hyperdrive)│
                      │  - environment links, managed Cloudflare Tunnel allocation   │
                      │  - mints one-time DPoP-bound bootstrap creds (via env)       │
                      │  - agent-activity ingest → APNs / FCM / Live Activities      │
                      └──────▲───────────────────────────────▲──────────────────────┘
             link/mint/publish│ (signed JWTs, env keypair)    │ device registration, push tokens
                              │                               │
┌─────────────────────────────┴────────────┐                  │
│ Environment = one Node server per machine│                  │
│  HTTP  /api/auth/* /api/orchestration/*  │◄── cloudflared ──┼── client app traffic (HTTPS/WSS)
│  WS    /ws  (Effect RPC, JSON)           │    tunnel        │   (or LAN / Tailscale / SSH fwd)
│  ┌────────────────────────────────────┐  │                  │
│  │ Orchestration engine               │  │           ┌──────┴───────────────────────────┐
│  │ command → decider → events (SQLite)│  │           │ Clients                          │
│  │ projector → read model             │  │           │  web (React/Vite), app.t3.codes  │
│  │ reactors → side effects → receipts │  │           │  desktop (Electron, bundles srv) │
│  └──────────────┬─────────────────────┘  │           │  mobile (Expo RN + native mods)  │
│  ProviderService│→ adapters (per instance)│           │  shared: packages/client-runtime │
│   Claude: Agent SDK query() → `claude`   │           └──────────────────────────────────┘
│   Codex:  `codex app-server` JSON-RPC    │
│   Cursor/Grok/Antigravity: ACP           │
│   OpenCode: SDK / per-thread server      │
│  Checkpoints: refs/t3/checkpoints/*      │
│  Terminals (node-pty), MCP server "t3-code" (HTTP) injected into Harness sessions
└──────────────────────────────────────────┘
```

Sources: [AGENTS.md "How it works"](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/AGENTS.md), [docs/internals/overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md), [docs/internals/remote.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/remote.md), [infra/relay/alchemy.run.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/alchemy.run.ts), [apps/server/package.json](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/package.json).

Key boundaries:
- **Execution stays with the environment.** "A remote client must never substitute its own filesystem, provider credentials, or machine state for the environment's." ([overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md))
- **Identity is separate from the route.** An environment ID is stable across restarts and endpoint changes. Projects and threads belong to exactly one environment, and work is never routed between environments ([remote.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/remote.md)).
- **Desktop can run without a local environment** (`localEnvironmentEnabled`). The renderer is served from disk via a `t3code://` scheme and always calls the environment's own URL ([remote.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/remote.md)).
- **Shared client logic lives in `packages/client-runtime`.** That covers the connection supervisor, per-environment registry, RPC session, thread cache and relay client, and it is shared by web and mobile ([connection-runtime.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/connection-runtime.md)).

## Protocol

**Transport.** `GET /ws` authenticates the upgrade and then runs `RpcServer.make(WsRpcGroup)` over `RpcServer.makeProtocolWithHttpEffectWebsocket` with `RpcSerialization.layerJson` ([apps/server/src/ws.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/ws.ts), around line 3820). The wire format is Effect RPC's framing: JSON request/response/chunk messages, with streams expressed as `stream: true` RPCs.

**Surface.** Everything crossing the wire is an Effect Schema in [packages/contracts/src/rpc.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/rpc.ts), about 1.5k lines. Groups:
- orchestration
- server config and settings
- provider auth, install and update
- projects, files and search
- VCS and worktrees
- pull requests
- terminal (`terminalOpen`/`Attach` stream/`Write`/`Resize`)
- previews, devices, assets and attachments
- usage and telemetry

**Orchestration methods** ([orchestration.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/orchestration.ts)):
- `orchestration.dispatchCommand` takes a `ClientOrchestrationCommand` union, including:
  - `thread.create`, `thread.turn.start`, `thread.turn.interrupt`
  - `thread.approval.respond`, `thread.user-input.respond`
  - `thread.checkpoint.revert`, `thread.conversation.revert`, `thread.session.stop`
  - `thread.runtime-mode.set`, `thread.interaction-mode.set`
  - archive, snooze, pin and settle commands, plus their reverses
- `orchestration.subscribeShell` streams the sidebar-level summary of all threads.
- `orchestration.subscribeThread` streams `{kind: "snapshot"} | {kind: "event"} | {kind: "synchronized"}`. It accepts `afterSequence` so a client that loaded a snapshot over HTTP can resume without a gap (the client dedupes by sequence), and it offers opt-in turn windowing and pagination via `turnLimit`/`beforeCursor`.
- `getTurnDiff` and `getFullThreadDiff` return diffs computed from checkpoints.

**Event vocabulary.** Persisted orchestration events include `thread.created`, `thread.message-sent`, `thread.turn-start-requested`, `thread.approval-response-requested`, `thread.turn-diff-completed`, `thread.activity-appended` and so on ([orchestration.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/orchestration.ts), around lines 2047–2200). Assistant text streams as `thread.message.assistant.delta`/`.complete`, and reasoning streams as `thread.message.reasoning.delta`.

**Versioning and compatibility** are core design constraints:
- Clients and environments upgrade independently. Features are negotiated through **capabilities advertised in the environment descriptor**, never by client version.
- Old wire fields are retained.
- Persisted events must stay decodable on replay because "an image-only server can fail the entire environment's startup when replaying one such event".
- Subscriptions carry opt-in flags so old clients never see union members they cannot decode (e.g. `environmentThemes` on `subscribeServerConfig`).

Sources: [overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md), [providers.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/providers.md), [rpc.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/rpc.ts).

**Connection-runtime lessons that apply directly to a mobile client** ([connection-runtime.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/connection-runtime.md)):
- One retry owner per environment (the supervisor), with capped backoff. Offline and auth failures wait for a wakeup instead of burning retries.
- **On foreground:** probe an established socket before replacing it. After a long mobile background suspension, *force* replacement, because the OS can kill a socket without reporting it closed.
- The socket opening is not "ready". The client waits for the initial server config, and shell and thread data each have their own sync state.
- Cached projections stay readable offline but must not overwrite newer live data. A thread-detail cache holds state plus the replay cursor for 5 idle minutes, so back-navigation resumes without re-downloading a snapshot.
- Mutations are not replayed automatically after reconnect.
- The desktop keeps every running thread subscribed. Web and mobile do not.

## Harness drivers

**Abstraction.** `ProviderAdapterShape` is defined in [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Services/ProviderAdapter.ts):
- Operations:
  - `startSession`, `sendTurn`, `interruptTurn`
  - `respondToRequest` (approval), `respondToUserInput` (structured questions)
  - `stopSession`, `readThread`, `rollbackThread`
  - optional `compaction` (native, or via a slash command)
  - `streamEvents: Stream<ProviderRuntimeEvent>`
- Capability flags: `sessionModelSwitch`, `promptlessTurnContinuation`, `supportsConversationRollback`.

The terms separate cleanly: a *driver* is the integration for a kind, and an *instance* is one configured account. Work is routed by instance so two accounts on the same driver share no state ([providers.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/providers.md), [glossary.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/glossary.md)).

**Normalized runtime events** ([providerRuntime.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/providerRuntime.ts)):
- session: `session.started`, `session.configured`, `session.state.changed`, `session.exited`
- turn: `turn.started`, `turn.completed`, `turn.aborted`, `turn.plan.updated`, `turn.diff.updated`, `turn.proposed.delta`, `turn.proposed.completed`
- items: `item.started`, `item.updated`, `item.completed`, `content.delta`
- requests: `request.opened`, `request.resolved`
- tools: `tool.progress`, `tool.summary`, `tool.denied`
- tasks: `task.*`
- `thread.token-usage.updated`, `account.rate-limits.updated`, `hook.*`, `mcp.status.updated`, `runtime.error`, `runtime.warning`

Each event carries `raw: {source, method, payload}`, where `source` is a tag such as `claude.sdk.message`, `codex.app-server.notification` or `acp.jsonrpc`. The raw native frame is therefore always kept.

### Claude Code

Implemented in [ClaudeAdapter.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/ClaudeAdapter.ts), about 5.6k lines.
- **Interface:** `@anthropic-ai/claude-agent-sdk` (`query`, `getSessionMessages`, `forkSession`), pinned to `^0.3.276` in [apps/server/package.json](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/package.json).
- **Session setup:**
  - It runs one long-lived `query()` per session with an `AsyncIterable<SDKUserMessage>` prompt and `includePartialMessages: true`.
  - `pathToClaudeCodeExecutable` points at the user's installed `claude`, so the user's subscription and auth are used.
  - `settingSources` loads the user's Claude settings.
  - The system prompt is the `claude_code` preset plus a T3 append.
  - The worktree and attachments directory are passed as `additionalDirectories`.
- **Approvals:**
  - `canUseTool` generates an `ApprovalRequestId`, emits `request.opened` with the tool name, input and suggestions, and awaits a `Deferred`.
  - The client's decision is `accept`, `acceptForSession`, `decline` or `cancel`. `acceptForSession` returns `updatedPermissions` built from the SDK's suggestions.
  - An abort signal cancels the request.
  - `AskUserQuestion` is routed to the user-input channel.
  - `ExitPlanMode` is intercepted: the plan becomes a `turn.proposed.completed` event and the tool is *denied* so Claude stops and waits.
- **Runtime modes:** `auto-accept-edits` maps to `acceptEdits`, `auto` to `auto`, and `full-access` to `bypassPermissions` + `allowDangerouslySkipPermissions`. `approval-required` uses the default mode and prompts. Plan mode is set with `query.setPermissionMode("plan")`.
- **Resume:** T3 stores a `resumeCursor` `{resume: sessionId, resumeSessionAt: lastAssistantUuid, turnCount, turnStartMessageIds}` in `provider_session_runtime.resume_cursor_json` and passes `resume` on restart.
- **MCP back-channel:** when a session has one, T3 injects its own HTTP MCP server `t3-code` (with an auth header) into `mcpServers`. This gives the Harness T3 tools such as device control ([apps/server/src/mcp](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/mcp)).
- **Importing existing sessions:** `agentSessions.scan`/`import` can import existing Claude and Codex CLI sessions into T3 threads ([agentSessions.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/agentSessions.ts)).

### Codex

Implemented in [CodexSessionRuntime.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/CodexSessionRuntime.ts), [CodexAdapter.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/CodexAdapter.ts) and [codexLaunchArgs.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/codexLaunchArgs.ts).
- **Interface:** it spawns `codex app-server` and speaks JSON-RPC over stdio.
- **Generated client:** the typed client is the workspace package `effect-codex-app-server`. Its [generator](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/effect-codex-app-server/scripts/generate.ts) pulls the JSON schemas from `openai/codex/codex-rs/app-server-protocol` at a pinned upstream ref and generates Effect Schemas from them.
- **Lifecycle:** it calls `thread/start` or `thread/resume` (falling back to a fresh start if resume fails), then `turn/start`. It consumes notifications such as `thread/started`, `turn/started`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated` and `serverRequest/resolved`.
- **Approvals** are server→client JSON-RPC requests handled with `client.handleServerRequest`: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` and `item/permissions/requestApproval`, plus MCP elicitations.
- **Runtime modes** map to thread config ([CodexSessionRuntime.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/CodexSessionRuntime.ts), around line 515):

| Mode | `approvalPolicy` | `sandbox` | `approvalsReviewer` |
| --- | --- | --- | --- |
| `approval-required` | `untrusted` | `read-only` | `user` |
| `auto-accept-edits` | `on-request` | `workspace-write` | `user` |
| `auto` | `on-request` | `workspace-write` | `auto_review` |
| `full-access` | `never` | `danger-full-access` | `user` |

- **Subagents:** Codex subagent threads (`source.subAgent.thread_spawn`) are surfaced as synthetic `collabAgent/*` events.
- **Protocol trap:** Codex *async* questions arrive as notifications and are answered with a new user message, not an RPC response. They can outlive a turn or a server restart ([providers.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/providers.md)).

### Other providers

- **ACP** (Agent Client Protocol) is used for Cursor, Grok and Antigravity, through the workspace package `effect-acp` and [apps/server/src/provider/acp](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/acp).
- **OpenCode** goes through `@opencode-ai/sdk`, with **one server per thread** because its MCP registrations are directory-scoped ([providers.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/providers.md)).
- **Health checks must not have side effects.** A probe must never open an authenticated session, because that can start MCP servers or hooks, or launch login browsers ([providers.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/providers.md)).

### Diffs and checkpoints

Sources: [CheckpointStore.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/checkpointing/CheckpointStore.ts), [GitVcsDriver.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/vcs/GitVcsDriver.ts) (around lines 790–1045), [checkpointing/Utils.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/checkpointing/Utils.ts).
- **Capture:** after each turn a reactor snapshots the workspace into `refs/t3/checkpoints/<base64url(threadId)>/turn/<n>`, using a temp index plus `write-tree`/`commit-tree`/`update-ref`. No commit lands on the user's branch.
- **Diffs:** the turn diff is computed between consecutive checkpoint refs and recorded as `thread.turn.diff.complete` with a file list ([orchestration.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/orchestration.ts)).
- **Revert** restores workspace and index. It must coordinate with the Harness conversation (`rollbackThread`), and providers that cannot roll back (Antigravity) reject the revert *before* touching files ([overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md)).
- **Timing:** turn completion and checkpoint settlement are separate milestones, so a late diff does not extend the turn or keep a spinner running.

## Session model and persistence

- **Terms** ([glossary.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/glossary.md)):
  - A *project* is an environment-local workspace root.
  - A *thread* is durable conversation plus work history, and survives provider process exits.
  - A *session* is the provider runtime attached to a thread and can be stopped or resumed without deleting the thread.
  - A *turn* is one user→agent cycle including checkpointing.
  - An *activity* is a non-message timeline item such as a tool call, approval or failure.
  - A *worktree* is an optional separate checkout per thread.
- **Storage:** SQLite at `<T3 home>/userdata/state.sqlite` via `node:sqlite` ([persistence/Layers/Sqlite.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/persistence/Layers/Sqlite.ts), [AGENTS.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/AGENTS.md)). Tables:
  - `orchestration_events`: global `sequence`, per-stream `stream_version`, command/causation/correlation IDs, JSON payload.
  - `orchestration_command_receipts`
  - `checkpoint_diff_blobs`
  - `provider_session_runtime`: thread → provider, adapter, runtime_mode, status, `resume_cursor_json`.
  - many `projection_*` read-model tables
  - auth sessions and pairing links
  - All are managed by more than 50 numbered migrations ([persistence/Migrations](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/persistence/Migrations)).
- **Idempotency rule:** events, projections and the command receipt commit in one transaction, and subscribers are notified only after the commit. A command ack means "intent recorded", not "provider finished" ([overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md)).
- **Sessions do not survive restarts.** A reaper stops provider sessions idle for 30 minutes (swept every 5 minutes), and the resume cursor rehydrates them on the next turn ([ProviderSessionReaper.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/provider/Layers/ProviderSessionReaper.ts)).

## Mobile / remote path

### Routes to an environment

These all reach the same server and none of them changes the execution model ([remote.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/remote.md), [remote-access.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/user/remote-access.md)):

1. **Direct LAN pairing.** Run `t3 serve --host <ip>` and `t3 pair`, then scan the QR code or paste the URL.
2. **Tailscale.** `t3 serve --tailscale-serve` gives an HTTPS `*.ts.net` URL. Tailscale is treated as "just an endpoint" with ordinary pairing ([packages/tailscale](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/tailscale)).
3. **Desktop-managed SSH.** The desktop downloads the server to `~/.t3/runtime` on the remote host (Linux or Apple Silicon), launches or reuses it, and forwards the port. It only stops a server it launched itself ([packages/ssh/src/tunnel.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/ssh/src/tunnel.ts)).
4. **T3 Connect.** Relay plus managed tunnel, described next.

### T3 Connect

Sources: [t3-connect.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/t3-connect.md), [infra/relay](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay).

**Stack:**
- a Cloudflare Worker deployed with Alchemy
- PlanetScale via Hyperdrive, with Drizzle
- Clerk for cloud identity
- Axiom for traces
- Cloudflare Tunnels plus DNS for endpoints ([alchemy.run.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/alchemy.run.ts))

**Linking:**
- The host runs `t3 connect`, which uses Clerk OAuth: PKCE through a loopback flow, or the **device authorization grant** over SSH or headless.
- The relay allocates a per-user-per-environment Cloudflare Tunnel and hostname.
- The environment runs `cloudflared` pointed at its loopback origin ([ManagedEndpointRuntime.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/cloud/ManagedEndpointRuntime.ts)).

**Connecting a client:**
1. The client signs in to the same Clerk account and picks an environment.
2. The relay asks the environment, over the tunnel with a signed, replay-guarded proof, to mint a **one-time bootstrap credential bound to the client's DPoP key**.
3. The client redeems it *directly with the environment* for an environment session.
4. The relay never sees the session token. All later HTTP/WS traffic goes client → tunnel hostname → environment ([EnvironmentConnector.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/src/environments/EnvironmentConnector.ts), [cloud/http.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/cloud/http.ts)).

**Trust model:** stated explicitly as "the relay holds the signing authority for mint requests… DPoP… does not make a compromised relay signing key harmless."

**Cost hygiene:** idle tunnels (down for at least 5 minutes) are reaped, and the host re-provisions under the same allocation on wake, so the hostname is stable ([ManagedEndpointReaper.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/src/environments/ManagedEndpointReaper.ts)).

### Environment auth

Source: [environment-auth.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/environment-auth.md), with endpoints in [environmentHttp.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/environmentHttp.ts).
- **Pairing** delegates scopes. Exchanging a credential can narrow scopes but never widen them.
- Raw pairing secrets are returned only at creation.
- Hosted pairing URLs put the secret in the **URL fragment** so it never reaches the hosted origin ([remote.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/remote.md)).
- Cookies, bearer tokens and DPoP all map to one scoped session model.
- Bearer and DPoP clients get a short-lived **WS ticket** over HTTP, so long-lived tokens stay out of socket URLs.
- Every RPC declares a required scope ([RpcAuthorization.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/auth/RpcAuthorization.ts)).
- Endpoints: `/api/auth/websocket-ticket`, `/api/auth/pairing-token`, `/api/auth/clients/revoke`, and others.

### Mobile app

Source: [apps/mobile](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile).

**Stack:** Expo 57, React Native 0.86, Reanimated 4, Legend List and Uniwind ([apps/mobile/package.json](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile/package.json)). It shares `packages/client-runtime` with web.

**Native modules** ([apps/mobile/modules](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile/modules)):
- `t3-review-diff`: Swift diff renderer
- `t3-terminal`: libghostty surface on iOS, libghostty-vt on Android, fed by the terminal RPC stream ([README](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile/modules/t3-terminal/README.md))
- `t3-markdown-text`: derived from Bluesky's, MIT
- `t3-composer-editor`: derived from Expo's, MIT
- `t3-native-controls`: AVKit and Quick Look presentation
- `t3-agent-notifications`
- `t3-subscription-widget`

**UX fidelity:** they patch `react-native-screens` to get UIKit header morph and back-gesture behaviour right ([mobile-navigation.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/mobile-navigation.md)).

**Push:**
- The environment publishes a compact `RelayAgentActivityState` to the relay with a JWT signed by the environment key ([AgentAwarenessRelay.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/server/src/relay/AgentAwarenessRelay.ts)). The state contains project and thread title, a phase (`starting`/`running`/`waiting_for_approval`/…), headline, model and a deep link.
- The relay fans this out to APNs (including Live Activity push-to-start tokens) and FCM ([relay.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/packages/contracts/src/relay.ts), [infra/relay/src/agentActivity](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/infra/relay/src/agentActivity), [registrationPayload.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile/src/features/agent-awareness/registrationPayload.ts)).
- Widgets use `expo-widgets` with frequent updates ([app.config.ts](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/mobile/app.config.ts)).
- Push **requires T3 Connect**. Direct and Tailscale connections get no background delivery ([mobile-notifications.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/user/mobile-notifications.md)).

## Licence and reuse assessment

**Licence:**
- The repo is MIT, © 2026 T3 Tools Inc. ([LICENSE](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/LICENSE)), and every workspace `package.json` declares MIT.
- Vendored pieces carry their own MIT notices: Expo and Bluesky for the mobile modules, and Ghostty in `t3-terminal/THIRD_PARTY_NOTICES.md`.
- MIT is GPL-compatible, so Polaris can borrow freely with attribution (keep the copyright notice).
- **Caveat:** `@anthropic-ai/claude-agent-sdk` is under Anthropic's own terms, not OSS. That matters if Polaris is open-sourced and bundles it.

| Piece | Reuse value for Polaris | How |
| --- | --- | --- |
| Event-sourced orchestration (command → decider → events → projector; receipts; reactors) | **High** (Daemon core) | Re-implement in Rust; copy the invariants from [overview.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/docs/internals/overview.md) |
| `ProviderAdapter` shape + `ProviderRuntimeEvent` union | **High** (Harness abstraction) | Use as a checklist for the Rust trait and event enum; keep `raw` native frames |
| Codex app-server integration | **High** | Same approach: generate types from `codex-rs/app-server-protocol` JSON schemas (Rust can use them directly, since the schemas come from Rust types upstream) |
| Claude via Agent SDK | **Medium** | The SDK is TS-only. A Rust Daemon must either speak Claude Code's `stream-json` + control protocol directly or run a Node sidecar. T3's `canUseTool`/ExitPlanMode/AskUserQuestion handling is the behaviour spec to match |
| Hidden-ref git checkpoints for per-turn diffs/restore | **High** | Small, language-agnostic algorithm; directly portable |
| Snapshot + `afterSequence` replay subscription; capability negotiation; schema-compat rules | **High** (Daemon ↔ Client protocol) | Design pattern |
| Connection supervisor rules (foreground probe, forced reconnect after suspension, readiness ≠ socket open) | **High** (Mobile App) | Design pattern |
| Pairing (fragment secret, scoped, narrow-only), DPoP, WS tickets, per-RPC scopes | **High** | Design pattern |
| T3 Connect relay + Cloudflare Tunnel broker | **Medium** | Good reference if Polaris ever needs a hosted relay; heavy ops (Clerk, PlanetScale, CF billing). Tailscale covers the personal use case |
| Push / Live Activities via relay | **Medium-later** | The shape of the payload (`RelayAgentActivityState`) and the phase set are reusable |
| Mobile RN app + native modules | **Reference only** | If Polaris Mobile is native Swift, the modules (diff, libghostty terminal) show what "great" requires |
| Code (TS/Effect) itself | **Low** for a Rust/GPUI stack | Not directly linkable |

## Implications for Polaris

1. **Keep the "one Daemon per Host, everything else a Client" hypothesis.** T3 Code shipped exactly that to about 200k users (per [AGENTS.md](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/AGENTS.md)) across web, desktop and mobile. It rules out a Desktop-App-embedded engine unless that engine is the same Daemon.
2. **Session vs. conversation.** T3 keeps a durable *thread* distinct from a restartable provider *session*. The Polaris glossary's Agent Session is "one conversation with one Harness". The map should decide whether an Agent Session survives Harness process exit and Daemon restart (T3: yes, via resume cursor). Also decide whether "thread" belongs in the *Avoid* list only as a word, since the concept is needed.
3. **Harness driving is confirmed as structured protocols:** Codex `app-server` (JSON-RPC, published schemas) and Claude via the Agent SDK. For a Rust Daemon the Claude path is the open risk: either implement Claude Code's CLI stream-json/control protocol directly (undocumented surface, versions churn) or accept a Node sidecar just for Claude. Consider also ACP as a third generic path, since T3 uses it for 3 of 6 providers.
4. **Diff and review can be Harness-independent** with hidden-ref checkpoints. That directly helps the Editor milestone's review UX pain point.
5. **Design the Daemon protocol for Mobile from day one:**
   - resumable subscriptions (snapshot + sequence)
   - per-thread streams, so a phone does not download everything
   - capability flags instead of version checks
   - per-RPC scopes
   - pairing that works via QR
6. **Connectivity for M1:** SSH bootstrap (install, launch and forward, like T3's desktop-managed SSH) plus Tailscale cover the user's Mac → Linux VM case with no hosted infrastructure. A relay is needed **only** for (a) reaching Hosts without Tailscale and (b) **push notifications / Live Activities**. The push point is the non-obvious one: *great mobile UX needs a hosted component* (APNs requires a server holding the key). The Mobile milestone should plan for a small relay even if connectivity stays on Tailscale.

## Open questions

- Does Polaris want an open-source licence that makes bundling the Claude Agent SDK a problem? The alternatives are a sidecar that the user installs, or talking to the `claude` CLI directly.
- How stable is Claude Code's stream-json control protocol for direct (non-SDK) use from Rust? Needs its own research ticket against the SDK source and the CLI.
- Should the Polaris Daemon adopt ACP as its generic Harness interface, or only Claude and Codex native protocols?
- Mobile App client tech: React Native (T3 proves it can be excellent, but it took many native modules and patches) vs. native SwiftUI (iOS-only, and the user is on macOS)?
- Is a hosted relay acceptable for a personal tool, and could APNs push be sent directly from the Daemon instead? That would require the APNs key on each Host, which has its own trade-offs.
- Not verified here: how the web client renders diffs, and whether `getTurnDiff` returns patches or file lists. Only the contract field names were checked.
