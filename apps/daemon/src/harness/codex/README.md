# Codex Harness driver

Implements `HarnessDriver` (`../HarnessDriver.ts`) for Codex by driving the user's own, unmodified `codex` binary through `codex app-server`. Linear: ENG-191; decisions in ENG-171 and ENG-175.

## Design

| File | Role |
|---|---|
| `CodexDriver.ts` | `makeCodexDriver(options)`: the driver value. `probe` runs `codex --version` and nothing else. `capabilities = { steer: true, liveCoAttach: true }`. |
| `AppServer.ts` | The one app-server per Host: `codex app-server --listen unix://<socket>`, started lazily on the first `open`, stopped when the driver's scope closes. If something already answers on the socket (a server left by a previous Daemon), it is reused so live threads survive a Daemon restart. |
| `RpcConnection.ts` | JSON-RPC 2.0 over app-server's Unix-socket transport, which is **WebSocket over the socket** (HTTP Upgrade, one message per text frame). Bun's WebSocket client speaks it as `ws+unix://<path>`. |
| `CodexSession.ts` | One Agent Session = one connection + one Codex thread. Translates notifications and server→client requests into `HarnessEvent`s. |
| `mapping.ts` | Pure translations: permission modes, turn input, thread items → `TurnItem`s, approval decisions. |
| `protocol.ts` | Effect Schemas that validate the fields the driver reads, each checked at compile time against the generated type. |
| `generated/` | TypeScript bindings from `codex app-server generate-ts`, trimmed to the import closure of what the driver uses. Generated from **codex-cli 0.157.1** (`generated/version.ts`). |
| `testing/FakeAppServer.ts` | A scriptable fake app-server on a real Unix socket (same WebSocket transport) and a replayer for recorded traffic. |

### Shared server and live co-attach

The Daemon owns one app-server per Host on `~/.polaris/codex.sock` (keep it short: Unix socket paths are capped near 104 bytes; app-server itself symlinks long paths, but other clients may not). Each `open` makes its own connection, sends `initialize`/`initialized`, then `thread/start` (fresh) or `thread/resume` with `excludeTurns: true` (`resumeCursor`). The thread id is the cursor (`CursorAssigned`). Closing the session's scope sends `thread/unsubscribe` and closes the connection; the app-server unloads the thread after its own 30-minute idle grace.

`terminalCommand` is `codex resume <threadId> --remote unix://<socket>`. The TUI attaches to the same server, and `thread/resume` on a loaded thread rejoins it, so Polaris and the TUI see the same live events and either can answer an approval. Polaris then gets `serverRequest/resolved` and emits `ApprovalWithdrawn`. Turns the TUI starts reach Polaris as notifications for an unknown Codex turn id. The driver mints a `TurnId` for them and emits `TurnStarted`. The same happens when Polaris rejoins a thread mid-Turn.

Verified on this Host (codex-cli 0.157.1): `--listen unix://PATH` serves WebSocket-over-Unix (a raw HTTP Upgrade returns `101`), and Bun's `ws+unix://` connects to it. `codex app-server proxy --sock` is a raw byte pipe, not a JSONL bridge, so it isn't used. The TUI's `--remote unix://` flag exists on both `codex` and `codex resume`. A hands-on co-attach with a live TUI (mid-Turn attach, both sides seeing one approval) has **not** been exercised yet; it needs a PTY test.

### Event mapping

| app-server | HarnessEvent |
|---|---|
| `thread/start`/`thread/resume` result | `CursorAssigned { cursor: thread.id }` |
| `turn/started` (or first sight of an unknown turn id) | `TurnStarted` |
| `item/agentMessage/delta`, `item/plan/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta` | `ItemDelta { field: "text" }` |
| `item/commandExecution/outputDelta` | `ItemDelta { field: "output" }` |
| `item/completed` | `ItemCompleted`: agentMessage/plan → AssistantMessage, reasoning → Reasoning (summary, else raw content), commandExecution → CommandExecution, fileChange → FileChange (`update` → `modify`), mcpToolCall → ToolCall `server.tool`, dynamicToolCall/collabAgentToolCall/webSearch/imageView → ToolCall. User messages, compaction and review markers are skipped. |
| `turn/plan/updated` | the latest plan is emitted once as a `Plan` item (id `<codexTurn>:plan`) just before `TurnEnded` |
| `error` with `willRetry: false` | `ItemCompleted` with an `Error` item |
| `turn/completed` | `TurnEnded { status, error }` |
| `thread/name/updated` | `TitleSuggested` |
| `serverRequest/resolved` for a request Polaris didn't answer | `ApprovalWithdrawn` |
| connection closed by the server | `Exited { error }`; scope close gives `Exited { error: null }` |

Notifications for other threads on the shared server are ignored.

### Approvals

| server request | ApprovalKind | `respond` sends |
|---|---|---|
| `item/commandExecution/requestApproval` | `command` | Allow → `accept` (`acceptForSession` if `remember`), Deny/Answer → `decline` |
| `item/fileChange/requestApproval` | `file-change` | same |
| `item/permissions/requestApproval` | `tool` | Allow → grants exactly the requested profile, scope `session` if `remember` else `turn`; Deny → `{}` |
| `item/tool/requestUserInput` | `question` | Answer → the text for every question; Allow → each question's first option; Deny → no answers |
| `mcpServer/elicitation/request` | `tool` | Allow → `accept` `{}`; Answer → `accept` `{answer}`; Deny → `decline` |
| anything else (`item/tool/call`, `account/chatgptAuthTokens/refresh`, `attestation/generate`, legacy v1 approvals) | — | JSON-RPC error `-32601`. Polaris never handles credentials. |

**Async questions** are agent messages with `delivery: "async"` and `questions`. They arrive as `item/completed` notifications, not requests, and can outlive their Turn. Each question becomes an `ApprovalRequested` of kind `question`. `respond` with `Answer` sends the text as a new user message: `turn/steer` if a Turn is in flight, otherwise `turn/start` of a new Turn, which gets a minted `TurnId` and a `TurnStarted`. Allow and Deny just close the question.

### Permission modes

| Polaris | `approvalPolicy` | `approvalsReviewer` | sandbox |
|---|---|---|---|
| supervised | `untrusted` | `user` | `read-only` |
| auto-edits | `on-request` | `user` | `workspace-write` |
| auto | `on-request` | `auto_review` | `workspace-write` |
| full-access | `never` | `user` | `danger-full-access` |

The table follows T3 Code's runtime modes. These values go on `thread/start`/`thread/resume` and on every `turn/start` (as `sandboxPolicy`); Codex persists turn overrides on the thread. `setPermissionMode` takes effect from the next `turn/start`.

### Other commands

- `sendTurn`: `turn/start` with a text input, plus a `localImage` input (staged Host path) per image attachment. Other attachments are listed by path at the end of the prompt. Fails if a Turn is already in flight.
- `steer`: `turn/steer` with `expectedTurnId` set to the in-flight turn. Fails if none is in flight.
- `interrupt`: `turn/interrupt`, or nothing when idle. The Turn then ends `interrupted`, and open approvals come back as `ApprovalWithdrawn`.

## Regenerating the bindings

```sh
bun apps/daemon/src/harness/codex/generate.ts            # uses `codex` on PATH
bun apps/daemon/src/harness/codex/generate.ts --codex /path/to/codex
bun run typecheck                                         # fails where protocol.ts drifted
```

It runs `codex app-server generate-ts` (stable surface, no `--experimental`) into a temp directory, copies the import closure of the roots listed in `generate.ts`, formats with Biome, and rewrites `generated/version.ts`. To use a new message, add its type to `ROOTS` and a schema plus a `conforms<…>` line in `protocol.ts`.

## Tests

- `mapping.test.ts`: the pure rules.
- `CodexDriver.test.ts`: the driver against `FakeAppServer` on a real Unix socket. It covers a full Turn replayed from `fixtures/full-turn.jsonl` (recorded from a real codex 0.157.1 Turn, with paths and account notifications scrubbed), a command approval round-trip, interrupt with a withdrawn file-change approval, resume that rejoins a TUI-started Turn and steers it, an async question answered by a new Turn, refusal of a credential request, a dropped server, and a side-effect-free `probe`.
- `e2e.test.ts`: one real tiny Turn against the installed codex in a temp git repo. It uses your Codex sign-in and quota:

  ```sh
  POLARIS_E2E_CODEX=1 bun test apps/daemon/src/harness/codex/e2e.test.ts
  ```

  Set `POLARIS_CODEX_TRACE=/tmp/trace.jsonl` to record every JSON-RPC frame, for example to refresh the fixture.

## Known gaps / TODO

- **Foreign Turns have no prompt.** Turns started in the TUI surface as `TurnStarted` with a minted `TurnId`, but `HarnessEvent` carries no user message, so the engine can't show what was typed. This needs a small contract addition (a prompt on `TurnStarted`, or a `UserMessage` TurnItem).
- **Live co-attach is unverified by hand** (see above). `ReturnFromTerminal` needs nothing from this driver, because Polaris never detaches.
- **Plans appear only at Turn end.** The contract has no item upsert, so live plan steps aren't streamed.
- **No `ItemStarted`.** A running command shows up only through output deltas until `item/completed`.
- **MCP form elicitations** accept with empty content; there's no UI for `requestedSchema` yet. An elicitation with no Turn mints a Turn that never ends.
- **Multi-question `requestUserInput`**: one Answer fills every question.
- **App-server lifecycle**: a spawned server is killed with its scope, so a Daemon restart ends a live TUI co-attach. A server that survived a crash is reused even if the installed codex has since been upgraded. Nothing restarts a server that dies between `open`s until the next `open`.
- **PATH under launchd**: `Bun.which("codex")` may miss nvm/Homebrew installs when the Daemon runs as a user service. Pass `codexPath` or resolve it from a login shell.
- `bun run licenses:check` isn't runnable yet (`scripts/licenses.ts` isn't in the tree). This module adds no dependencies.
