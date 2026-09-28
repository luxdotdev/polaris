# What the GPUI ecosystem offers Polaris

Research for [ENG-182](https://linear.app/luxdev/issue/ENG-182), researched 2026-09-27.

**Question:** What already exists in the GPUI ecosystem that Polaris could reuse or learn from? The survey covers Delta, the agent orchestrators listed on awesome-gpui, tty7, and Longbridge's gpui-component (now called gpui-kit). For each one it records the licence, how mature and active it is, its architecture, and what Polaris could reuse.

**Method:** I shallow-cloned every repo at its default-branch HEAD on 2026-09-27 and read the READMEs, the architecture docs and the source. Star counts, licences and push dates come from the GitHub API. Delta is closed source, so its facts come from delta.dev and its docs. All sources are primary, and each claim links to one.

---

## TL;DR

- **gpui-kit (the former `longbridge/gpui-component`) is the building block to adopt.** It is Apache-2.0, has about 14.9k stars and ships releases every week (v0.6.6 on 2026-09-21). It runs on the published `gpui-pre` crate and provides docks, virtual lists and tables, markdown and a Tree-sitter code editor. Polaris would not need to fork Zed's GPL `ui` or `editor` crates.
- **The gpui-kit editor can carry an early Editor milestone, but it is not Zed's editor.** It already has LSP *provider traits* (completion, hover, definition, code actions, semantic tokens, document colours), diagnostics, text and range decorations, inline (ghost-text) completion, folding, multi-cursor and search. **Polaris would have to supply three things itself:** an LSP client and transport (gpui-kit ships none), a diff view (there is no diff or merge editor), and block or inlay widgets such as inline-chat boxes between lines. OxiMux (Apache-2.0) shows the first gap is cheap to fill: it pairs gpui-kit's `Editor` with a hand-rolled LSP client of about 1.2k lines.
- **Zeron is the closest match to Polaris's architecture** (MIT, about 2.2k stars, very active). Each device runs an engine daemon (`zeron headless`, systemd or launchd). A gpui UI is a Client over typed WebSocket RPC, and the protocol stays the same whether the engine runs in-process or as a separate daemon. It has a `Harness` trait with Claude Code (stream-json), Codex (app-server JSON-RPC), ACP, Cursor and OpenCode adapters. Its optional multi-device sync uses Loro CRDTs relayed through Cloudflare Durable Objects.
- **Waku is the best reference for driving many harnesses** (GPL-3.0, about 1.5k stars). A standalone `waku-daemon` sits behind an authenticated, versioned WebSocket protocol that is also generated for a web client. It has 7 transports behind 11 providers: Codex app-server, ACP, OpenCode HTTP+SSE, Pi RPC, a Claude streaming-input session, Amp and DeepSeek. Its `docs/providers.md` is the best write-up of harness quirks I found. Because it is GPL-3.0, Polaris can study it but should only copy code if Polaris is GPL.
- **tty7 is the best reference for the Daemon's PTY and remote-Host layer** (Apache-2.0, about 1.1k stars). A persistent daemon owns the PTYs, and a versioned framed protocol has feature flags. Remote workspaces work by installing a static musl `tty7-server` over SSH, and the daemon can upgrade itself with `execve` without killing the PTYs. It also ships a CLI and skill that agents can drive. It watches agents by detecting them and installing hooks, not through structured protocols.
- **Every serious app pins or forks GPUI:** zeronsh/zui, egoist/zed@waku-webview, l0ng-ai/zed@tty7, vendored copies, `gpui-pre` and `gpui-ce`. Polaris should plan for the same, preferably by pinning `gpui-pre` in lockstep with gpui-kit, which pins `gpui-pre =0.3.6`.
- **Delta (Zed Industries) is a different product.** It is a closed-source, cloud-backed (Cloudflare) multiplayer app that runs Zed's *own* agent over model APIs or subscriptions. It does not orchestrate the user's Claude Code or Codex binaries, it needs a Zed account and it is in public beta (2026-09-16). Its ideas are worth borrowing (thread = conversation + checkout, DeltaDB fine-grained deltas, rewinding a thread), but none of its code is available.
- **Other orchestrators I surveyed:** Arbor, OxiMux, Runner, Hadron, Codux, Vibex, Farcaster, hunk. Most are small (under 1k stars) and PTY- or worktree-centric, and most are only months old. The patterns keep recurring: a daemon plus GUI split, `alacritty_terminal` + `portable-pty`, SQLite state, git worktrees per agent, an MCP server or CLI so agents can drive the app, and iroh or relay links for mobile.
- **What makes Polaris different is the combination, not any single feature.** No surveyed project combines all four: (1) a headless per-Host Daemon that manages remote Linux Hosts from a Mac as first-class, (2) a *real* IDE Editor milestone (LSP on remote Hosts, line-targeted inline chat, code review in the editor), (3) structured Harness drivers with a terminal escape hatch, and (4) a DAG layer over Agent Sessions. Zeron and Waku come closest on (1) and (3), tty7 on the remote half of (1), and nobody does (2) or (4) well.

---

## Comparison table

Stars, licence and dates come from the GitHub API on 2026-09-27. "Last commit" is the latest default-branch commit.

| Project | Licence | Stars | Created | Last commit / release | GPUI source | UI kit | Daemon / remote Hosts | Harness interfaces |
|---|---|---:|---|---|---|---|---|---|
| [gpui-kit](https://github.com/longbridge/gpui-kit) (ex gpui-component) | Apache-2.0 (docs also CC BY 4.0) | 14,863 | 2024-06 | 2026-09-27 / v0.6.6 (2026-09-21) | `gpui-pre =0.3.6` | n/a | n/a (UI library) | n/a |
| [Zeron](https://github.com/zeronsh/zeron) | MIT | 2,249 | 2026-07 | 2026-09-27 / v0.2.94 (2026-09-26) | fork [zeronsh/zui](https://github.com/zeronsh/zui) | own + forked `gpui-base` | **Engine daemon per device** (headed/headless, WS RPC); optional multi-device via Loro + Cloudflare DO relay | Claude Code stream-json, Codex app-server, ACP (Devin, Antigravity, Pi…), Cursor, OpenCode |
| [Waku](https://github.com/egoist/waku) | **GPL-3.0** | 1,538 | 2026-07 | 2026-09-27 / v0.1.19 (2026-09-10) | fork egoist/zed@waku-webview | own | **`waku-daemon`** (authenticated, versioned WS; web client generated from the Rust types); remote daemon supported but no PTY or folder picker yet | Codex app-server, ACP, OpenCode HTTP+SSE, Pi RPC, Claude streaming-input NDJSON, Amp, DeepSeek Harness |
| [tty7](https://github.com/l0ng-ai/tty7) | Apache-2.0 | 1,133 | 2026-07 | 2026-09-28 / nightly | fork l0ng-ai/zed@tty7 | forked gpui-component | **Persistent PTY daemon**; SSH-installed `tty7-server` on remote Hosts; `execve` hand-off upgrade | PTY + agent hooks (detects 25 CLIs), no structured protocol |
| [Arbor](https://github.com/penso/arbor) | MIT | 830 | 2026-03 | 2026-09-21 (packaging only; last code commit 2026-04) | `gpui 0.2.2` (crates.io) | own | `arbor-httpd` daemon (HTTP/WS), SSH or mosh "outposts", MCP server, CLI, web UI | ACP (via acpx), OpenAI-compatible APIs; detects Claude/Codex/OpenCode in PTYs |
| [Codux](https://github.com/duxweb/codux) | **GPL-3.0** | 461 | 2026-04 | 2026-07-21 (quiet) | zed git HEAD | gpui-component @rev | headless host + phone over iroh P2P (beta) | PTY wrappers for 9+ CLIs (status, tokens, memory injection) |
| [Runner](https://github.com/yicheng47/runner) | MIT | 177 | 2026-04 | 2026-09-27 / v0.12.0 (2026-09-27) | `gpui-ce 0.3` | own | none (single-process app + CLI + MCP) | PTY only ("each agent keeps its own TUI") |
| [hunk](https://github.com/smolcars/hunk) | GPL-3.0 | 74 | 2026-02 | 2026-08-26 | n/a | n/a | n/a | Codex (diff viewer + orchestrator) |
| [Farcaster](https://github.com/behzade/farcaster) | **GPL-3.0** | 64 | 2026-08 | 2026-09-27 | vendored zed@cc053a4 | vendored gpui-component | none | Codex app-server, Pi RPC, OpenCode server, Cursor ACP, Claude `claude -p`, Antigravity ACP; embedded Neovim via libghostty |
| [OxiMux](https://github.com/nhtera/OxiMux) | Apache-2.0 | 56 | 2026-07 | 2026-09-24 / v0.1.29 | `gpui-pre 0.3.5` | **gpui-kit** (fork @rev) | `oximux-relay` PTY daemon; `oximux serve` headless host; iroh remote | ACP, Claude stream-json, Codex, Pi/omp NDJSON |
| [Hadron](https://github.com/s0lda/hadron) | Apache-2.0 | 26 | 2026-07 | 2026-09-21 | fork s0lda/zed | forked gpui-component | `hadron-gluon` daemon over a file event bus (`field.jsonl`) | ACP, OpenAI-compatible/Ollama, CLI/PTY "seats" |
| [Vibex](https://github.com/vibex-ai/vibex) | **AGPL-3.0** | 14 | 2026-07 | 2026-09-25 | `gpui-pre =0.3.5` | gpui-kit 0.6.4 (crates.io) | desktop is the runtime; mobile via Direct/Tailnet/self-hosted encrypted relay | **ACP only** ("the only online Agent transport") |
| [Delta](https://delta.dev/) (Zed Industries) | proprietary (no licence published; beta agreement) | n/a | beta 2026-09-16 | n/a | presumably Zed's GPUI (not published) | n/a | local app + cloud runner + web; DeltaDB on Cloudflare | Zed's built-in agent; models via API keys, ChatGPT/Copilot/Grok subscriptions, Zed-hosted |

Sources for the table: the repo links above, the awesome-gpui list ([README](https://github.com/zed-industries/awesome-gpui)), and the dependency declarations in each repo's `Cargo.toml`.

---

## gpui-kit (gpui-component) deep dive

### What it is now

- The project was renamed: `longbridge/gpui-component` redirects to [`longbridge/gpui-kit`](https://github.com/longbridge/gpui-kit). It is split into three layers ([README](https://github.com/longbridge/gpui-kit#framework-architecture), [ARCHITECTURE.md](https://github.com/longbridge/gpui-kit/blob/main/docs/ARCHITECTURE.md)):
  - `gpui-base`: unstyled behaviour, state and infrastructure. This layer contains the text-editing engine.
  - `gpui-component`: the styled component catalogue.
  - `gpui-shell`: an optional JavaScript extension runtime.
  - `gpui-kit`: an umbrella crate that re-exports all of the above plus GPUI.
- **Licence:** Apache-2.0 on every crate (`license = "Apache-2.0"` in each `crates/*/Cargo.toml`). Documentation prose is also offered under CC BY 4.0 ([LICENSE-DOCS.md](https://github.com/longbridge/gpui-kit/blob/main/LICENSE-DOCS.md)). This is compatible with the GPL-compatible licence planned for Polaris.
- **GPUI pin:** `gpui = { package = "gpui-pre", version = "=0.3.6" }` in the workspace [Cargo.toml](https://github.com/longbridge/gpui-kit/blob/main/Cargo.toml). `gpui-pre` is published from zed-industries/zed as a "gpui-pre snapshot of zed@bcf6582" and was updated on 2026-09-21 ([crates.io](https://crates.io/crates/gpui-pre)). Taking gpui-kit therefore means pinning the matching `gpui-pre`.
- **Maturity:**
  - About 14.9k stars, 933 forks and 100+ contributors.
  - Releases v0.6.1 through v0.6.6 all shipped in September 2026.
  - It is the UI of Longbridge Pro, a shipping commercial trading app ([README showcase](https://github.com/longbridge/gpui-kit#showcase)).
  - Its authors describe it as "Production Ready".
  - Four of the surveyed orchestrators use it or fork it: tty7, OxiMux, Vibex and Farcaster. Codux and Hadron use the older gpui-component.
- **Relevant components** (list from [website/component](https://github.com/longbridge/gpui-kit/tree/main/website/component)):
  - Dock layout: resizable panels, draggable tabs, nested splits, edge docks. `DockAreaState` round-trips through serde ([dock.md](https://github.com/longbridge/gpui-kit/blob/main/website/component/dock.md)).
  - Virtual list and data table: variable-height rows, hundreds of thousands of rows.
  - Tree, command palette, sidebar, tabs, title bar, status bar, settings, notifications.
  - Markdown and HTML text view, charts, a `webview` crate (`gpui-wry`).
  - AccessKit accessibility, headless UI integration tests, and WebAssembly builds.
- **Gaps:**
  - **No terminal component.** Everyone pairs `alacritty_terminal` (or libghostty) with their own grid element.
  - **No diff viewer.**

### The code editor: can it carry the Editor milestone?

The engine lives in `gpui-base` under [`crates/base/src/input`](https://github.com/longbridge/gpui-kit/tree/main/crates/base/src/input), about 20k lines. The biggest files are `base/state.rs` (10.2k lines) and `base/element.rs` (4.5k lines). It is a rope-based (`ropey`) editor with a display map (wrap and fold maps) and a sum-tree. The styled `Editor`/`EditorState` in `gpui-component` wraps it ([editor.md](https://github.com/longbridge/gpui-kit/blob/main/website/component/editor.md)).

| Editor-milestone need | gpui-kit today | Evidence |
|---|---|---|
| Syntax highlighting | ✅ Tree-sitter, about 35 grammars behind features (`tree-sitter-rust`, …, `tree-sitter-diff`) | [component/Cargo.toml](https://github.com/longbridge/gpui-kit/blob/main/crates/component/Cargo.toml) |
| Large files | ✅ "Stable performance at 200K lines" (vendor claim) | [README features](https://github.com/longbridge/gpui-kit#features) |
| Line numbers, folding, whitespace, soft wrap, tab size | ✅ | [editor.md "Basic usage"](https://github.com/longbridge/gpui-kit/blob/main/website/component/editor.md) |
| Multi-cursor, column selection, find/replace (built-in panel or headless API) | ✅ | [editor.md](https://github.com/longbridge/gpui-kit/blob/main/website/component/editor.md) |
| LSP **features** | ✅ as provider traits: `CompletionProvider`, `CodeActionProvider`, `HoverProvider`, `DefinitionProvider`, `DocumentColorProvider`, `DocumentRangeSemanticTokensProvider`, plus a `window/showDocument` hook and `apply_lsp_edits` over `lsp_types::TextEdit` | [editor/lsp/mod.rs](https://github.com/longbridge/gpui-kit/blob/main/crates/base/src/input/editor/lsp/mod.rs) |
| Diagnostics (squiggles + popover) | ✅ `DiagnosticSet` with severity, code and source | [editor/diagnostics.rs](https://github.com/longbridge/gpui-kit/blob/main/crates/base/src/input/editor/diagnostics.rs) |
| LSP **client/transport** (spawning servers, JSON-RPC, lifecycle) | ❌ Not included. The example wires a mock `ExampleLspStore` | [examples/editor/src/main.rs](https://github.com/longbridge/gpui-kit/blob/main/examples/editor/src/main.rs) |
| Inline decorations | ✅ Text decorations (a `HighlightStyle` over a byte range, "counterpart of Monaco's IModelDeltaDecoration") and geometric range decorations (fill or frame). Ranges follow edits. Collections are owned handles | [editor/decorations.rs](https://github.com/longbridge/gpui-kit/blob/main/crates/base/src/input/editor/decorations.rs) |
| Ghost-text inline completion (for tab completion) | ✅ `accept_inline_completion` / `has_inline_completion` hooks in the editor mode | [editor/mod.rs](https://github.com/longbridge/gpui-kit/blob/main/crates/base/src/input/editor/mod.rs) |
| Inlay hints / **block widgets between lines** (inline-chat box, review comments) | ❌ Not found. There is no block-decoration or inlay API. Inline tokens exist only for single-line inputs and textareas | grep of `crates/base/src/input` |
| Gutter decorations (git change bars, breakpoints) | ⚠️ There is a gutter with line numbers and fold icons, but no public gutter-marker API | [base/element.rs](https://github.com/longbridge/gpui-kit/blob/main/crates/base/src/input/base/element.rs) |
| **Diff view** (side-by-side or unified, hunk staging, merge) | ❌ Not included. Only `.diff` syntax highlighting | component list; grep |
| Multi-buffer (Zed-style excerpts from many files in one view) | ❌ | n/a |
| Vim mode | ❌ Not found | n/a |

**What it looks like in practice:** [OxiMux](https://github.com/nhtera/OxiMux) (Apache-2.0) builds its editor on gpui-kit's `Editor` ([editor_view.rs](https://github.com/nhtera/OxiMux/blob/main/crates/editor/src/editor_view.rs)). Its LSP client is hand-rolled, about 1.2k lines across `client.rs`, `transport.rs`, `server_resolution.rs` and the providers ([crates/editor/src/lsp](https://github.com/nhtera/OxiMux/tree/main/crates/editor/src/lsp)). The authors wrote it by hand because `async-lsp` had an `lsp-types` version conflict, and they did not want to bridge two type universes. The client handles the `initialize` handshake, `didOpen`/`didChange`/`didSave`, hover, and a diagnostics broadcast, with a 5-second timeout on each request. That is a good template for Polaris.

**Verdict on the editor:**

- gpui-kit's editor can carry a *first* Editor milestone: view and edit files, syntax highlighting, diagnostics, completion, hover, go-to-definition, decorations that mark agent-touched ranges, and ghost-text tab completion.
- It **cannot** provide Cursor-style inline chat boxes or in-editor code review without new work, because both need block widgets between lines. Polaris would either contribute a block-decoration API upstream or render review and diff as a separate virtualized view. The second option is what Zeron does: a "unified-patch parser → virtualized file/hunk/line rows" diff pane ([ARCHITECTURE.md §4](https://github.com/zeronsh/zeron/blob/main/ARCHITECTURE.md)).
- **LSP on remote Hosts** fits the traits well. The providers are `Rc<dyn …>` returning GPUI `Task`s, so a provider can forward over the Daemon RPC to a language server on the Host instead of a local child process.
- **Risk to watch:** `state.rs` is a 10k-line file and the API is still pre-1.0. Pin a version and expect churn.

---

## The most notable orchestrators

### Zeron: the closest to Polaris's architecture (MIT)

Sources: [ARCHITECTURE.md](https://github.com/zeronsh/zeron/blob/main/ARCHITECTURE.md), [README](https://github.com/zeronsh/zeron), [crates/harness](https://github.com/zeronsh/zeron/tree/main/crates/harness/src).

- **Topology:** `gpui UI ─ in-proc/localhost RPC ─ engine`. "Engine = backend: runs agents, owns auth, terminals, repos/worktrees, diff sync, doc hosting. Pure Rust daemon, fully functional headless."
  - The UI "talks the same typed RPC whether the engine is in-process or a separate daemon". In-process mode uses an in-memory duplex "so the boundary stays honest".
  - The headed app also serves its embedded engine on the IPC port.
- **Daemon lifecycle:** `zeron daemon start|stop|restart|status`, a Linux installer that keeps the daemon running across reboots, and `zeron daemon install` for launchd on macOS.
- **Remote:** devices on the same synced account control each other through a Cloudflare "DeviceRoom" Durable Object relay (virtual sockets). Remote file access is enforced by the owning engine: `.git` is always blocked, and ignored files are visible only on opt-in. The README states the trust model plainly. **There is no SSH bootstrap.** Remote means another Zeron install on the same account, which suits "control my VPS" but not "attach to this Linux VM over SSH".
- **Data:** Loro CRDT "session docs" (transcript plus a durable command queue) and a workspace registry doc, stored locally in SQLite. Send, steer and interrupt are **durable command entries executed by the host device**, so offline sends queue up.
- **Harness trait:** `id`, `supports_steering`, `steering_mode`, `models()`, `commands()`, `skills()`, `run(...)`, and so on ([lib.rs](https://github.com/zeronsh/zeron/blob/main/crates/harness/src/lib.rs)). Adapters:
  - `claude` speaks the CLI's stream-json directly, "no adapter process in between".
  - `codex` maps app-server notifications to `AgentEvent`.
  - `acp`, `cursor` and `opencode`.
- **UI techniques worth copying:**
  - A virtualized transcript on gpui `list()` with a stick-to-bottom spring, block-granularity rows and memoized row heights.
  - Incremental markdown re-parse of the streaming tail.
  - A terminal built from `alacritty_terminal` + `portable-pty`, with a 1MB replay buffer and "detach ≠ close".
  - Zeron deliberately avoids Zed's GPL crates: "We do not use Zed's GPL crates (`markdown`, `ui`, `theme`, `editor`)".
- **Weaknesses for Polaris:** there is no editor (it is chat-first), the cloud relay is its own (TypeScript, Cloudflare), and GPUI is forked.

### Waku: the reference for multi-harness drivers (GPL-3.0)

Sources: [README "Architecture"](https://github.com/egoist/waku#architecture), [docs/providers.md](https://github.com/egoist/waku/blob/main/docs/providers.md).

- **Architecture:** "The native desktop is an RPC client of the standalone `waku-daemon` process … behind the authenticated, versioned WebSocket contract in `waku-protocol`."
  - The daemon owns task SQLite data, attachments, provider-native session forks and "all workspace filesystem and Git operations; paths returned by it always refer to the daemon host".
  - A browser client uses TypeScript types generated from the Rust protocol (`bun run protocol:generate` / `protocol:check`), including "request IDs, subscriptions, sequence deduplication, and replay cursors".
  - The daemon is loopback-only by default and can be exposed with a stable auth token.
  - **When the daemon is remote**, "the local folder picker and PTY are … unavailable until the protocol gains daemon-host picker and terminal-stream endpoints". Waku has not solved remote PTYs yet.
- **Harness drivers:** one `DriverStartOptions` → `DriverHandle` contract. Events are `Connected`, `TurnStarted`, `TextDelta`, `ReasoningDelta`, `Activity`, `Permission`, `SteerAccepted/Rejected`, `TurnFinished`, `ProcessExited`, and so on.
  - Tool events are normalized into one `ActivityItem` type: `Reasoning | Command | FileChange | Search | Plan | Tool`.
  - Steering support is advertised per transport, with a fallback to a follow-up queue.
  - There are "seven transport implementations behind eleven providers". Every one keeps a session that spans the whole conversation.
  - Runtimes are per session, not per view, so background sessions keep streaming.
- **Also notable:** conversation-aware git checkpoints ("rewind"), and experimental macOS computer use.
- **Licence caveat:** GPL-3.0-only. Polaris may read the design docs freely, but it may copy code only if Polaris itself is GPL-3.0.

### tty7: the reference for the Daemon's PTY and remote-Host layer (Apache-2.0)

Sources: [README](https://github.com/l0ng-ai/tty7), [concepts.mdx](https://github.com/l0ng-ai/tty7/blob/main/docs/getting-started/concepts.mdx), [remote/workspaces.mdx](https://github.com/l0ng-ai/tty7/blob/main/docs/remote/workspaces.mdx), [crates/tty7-core/src/daemon](https://github.com/l0ng-ai/tty7/tree/main/crates/tty7-core/src/daemon).

- **Server model:** "The window does not own your shells — a background server does." The CLI talks to the same server, and scrollback tails are persisted so that "a crash is not a catastrophe".
- **Remote Hosts:** tty7 installs a single static (musl on Linux) `tty7-server` into `~/.local/share/tty7/bin/` over its native `russh` SSH stack, with no sudo. The user approves the install once, and the prompt shows the path, version and SHA-256. From then on remote files, repos, diffs, worktrees and panes are "the remote machine's, rendered here". **This is essentially Polaris's M1 Host model, already working.**
- **Protocol:** frames are a u32 length, a one-byte kind and a serde payload. `PROTOCOL_VERSION = 6`, plus capability strings such as `resize-echo`, `restore-scrollback`, `handoff` and `update-server` ([protocol.rs](https://github.com/l0ng-ai/tty7/blob/main/crates/tty7-core/src/daemon/protocol.rs)). Clients feature-detect instead of lockstepping versions.
- **Zero-downtime daemon upgrade:** `handoff.rs` re-`execve`s the new binary while keeping the pid and every PTY master fd. Its module doc explains why any other method kills the shells.
- **The single-instance and stale-socket logic is carefully reasoned**, in `singleton.rs`, `transport.rs` and `update_guard.rs`.
- **Agents:** detection plus one-click hook install for 25 CLIs (status, notifications, resume after reboot, fork). There are no structured Harness protocols; "None of them are wrapped or proxied". There is also an agent-facing CLI and skill (`tty7 split/send/wait --until free/capture`).
- **For Polaris:** the best Apache-licensed code to read (and possibly borrow from, with attribution) for the Daemon's PTY ownership, the SSH bootstrap of a remote Daemon, protocol versioning and self-upgrade.

### Others, briefly

- **Arbor** ([repo](https://github.com/penso/arbor), MIT)
  - Has an `arbor-httpd` daemon shared by the GUI, web UI, CLI and **MCP server**, SSH or mosh "outposts", and a documented [terminal daemon contract](https://github.com/penso/arbor/blob/main/docs/daemon-contract.md) (`create_or_attach/write/resize/signal/detach/kill/snapshot`).
  - Agent chat goes over ACP through acpx.
  - The last code commit was in April 2026; recent commits are packaging only. Treat it as a stalled reference.
- **OxiMux** ([repo](https://github.com/nhtera/OxiMux), Apache-2.0)
  - The only surveyed app with a real **gpui-kit editor + LSP**. It also has a PTY relay daemon (`oximux-relay`), `oximux serve` headless hosts, iroh remote, a GitLens-style git UI, and ACP, Claude stream-json and Codex drivers.
  - Small (56 stars) but very active, with dense docs. The second-best Apache reference after tty7.
- **Runner** ([repo](https://github.com/yicheng47/runner), MIT)
  - Built around "crews" of PTY agents coordinated over a persisted event feed with `ask_human`.
  - Useful prior art for the DAG milestone: roles, crew, mission and a lead agent. It is PTY-only, has no daemon, and runs on `gpui-ce`.
- **Hadron** ([repo](https://github.com/s0lda/hadron), Apache-2.0)
  - A `hadron-gluon` headless daemon plus a GPUI "chamber". They talk over an NDJSON file bus. Agents get per-worktree isolation and an automatic merge gate that rebases and runs tests.
  - Its merge-gate idea is relevant to DAG automation. The project is tiny and very maximalist.
- **Codux** ([repo](https://github.com/duxweb/codux), GPL-3.0)
  - PTY wrappers with token analytics and memory injection. `codux-ssh`/`codux-db` wrappers keep credentials out of the agent's context. Phone and headless-host links go over iroh.
  - Quiet since July.
- **Vibex** ([repo](https://github.com/vibex-ai/vibex), AGPL-3.0)
  - Uses **ACP as the only agent transport** on gpui-kit, with a GPUI mobile client (`longbridge/gpui-mobile`) and an encrypted self-hosted relay.
  - Interesting as proof that GPUI runs on mobile, but AGPL and tiny.
- **Farcaster** ([repo](https://github.com/behzade/farcaster), GPL-3.0)
  - Each session is a row of harness, Neovim (in libghostty) and terminal. An MCP "workgraph" tracks tasks and dependencies across sessions.
  - Its [harness feature table](https://github.com/behzade/farcaster/blob/main/docs/harnesses.md) is a concise capability matrix (history, fork, steer, compact, modes, usage) across six harnesses.
- **Delta** ([delta.dev](https://delta.dev/), Zed Industries)
  - The unit of work is the "thread", which bundles a conversation with the checkouts it touches. It is recorded in **DeltaDB**, which stores fine-grained deltas instead of git commits, is replicated to every participant and can be rewound ([core concepts](https://delta.dev/docs/concepts/core-concepts), [Delta & Git](https://delta.dev/docs/concepts/delta-and-git)).
  - It uses its own managed checkouts rather than git worktrees ([worktrees](https://delta.dev/docs/concepts/worktrees)). The backend runs "entirely on Cloudflare" ([data storage](https://delta.dev/docs/privacy-and-security/data-storage)).
  - Models come from API keys, ChatGPT, Copilot or Grok subscriptions, or Zed-hosted models; a Claude subscription is "coming soon" ([models & providers](https://delta.dev/docs/agents/models-and-providers)). **The agent is Delta's own; it does not drive the user's Claude Code or Codex.**
  - Requires a Zed account. Runs on macOS (Apple Silicon), Linux and Windows ([installation](https://delta.dev/docs/installation)). No source code has been published; the only public repo is [delta-nix](https://github.com/zed-industries/delta-nix).

---

## Reuse recommendations

**Adopt as dependencies:**
1. **gpui-kit** (Apache-2.0) as the component layer: dock, virtual list and table, tree, command palette, markdown, and the editor. Pin `gpui-kit` and the matching `gpui-pre`. Build on `gpui-base` wherever Polaris wants to own the "IntelliJ-spacious" visual design.
2. **`alacritty_terminal` + `portable-pty`** (MIT/Apache) for terminals. Every surveyed app uses them, and libghostty-vt (Arbor, Farcaster) is the one alternative. The terminal element itself has to be written by Polaris or borrowed from an Apache/MIT app such as tty7 or Zeron.
3. **`agent-client-protocol`** (Apache-2.0) crate for the ACP-shaped Harness trait already chosen in ENG-171.

**Borrow patterns (Apache/MIT, with attribution):**
4. **tty7**:
   - Daemon PTY ownership.
   - The SSH install and version negotiation for the remote Daemon (static musl binary under `~/.local/share/...`, with a user approval that shows the SHA).
   - The framed protocol with capability flags.
   - `execve` hand-off upgrades.
   - Single-instance and stale-socket handling.
5. **Zeron**:
   - The same RPC whether the engine is in-process or a daemon, with an in-memory duplex in tests.
   - Durable command entries for send, steer and interrupt.
   - The Harness trait shape and its Claude stream-json and Codex app-server adapters.
   - The transcript virtualization and streaming-markdown techniques.
   - The diff-pane design.
6. **OxiMux**: the hand-rolled LSP client over `lsp-types` wired into gpui-kit providers. This is the template for the Editor milestone.
7. **Arbor**: the MCP and CLI surface over the daemon, so agents can drive Polaris (see also tty7's CLI and skill).

**Study only (GPL/AGPL, unless Polaris becomes GPL):**
8. **Waku**:
   - `providers.md` and the driver contract (event taxonomy, `ActivityItem` normalization, steer fallback).
   - Protocol codegen for non-Rust clients (relevant to the Mobile App).
9. **Farcaster**'s harness capability matrix and workgraph; **Codux**'s credential-isolating wrappers; **Vibex**'s GPUI-on-mobile approach.

**Do not depend on:** any fork of GPUI owned by another app (zui, egoist/zed, l0ng-ai/zed). Delta is not available to reuse at all.

---

## Positioning: what makes Polaris different

| | Polaris (planned) | Nearest existing |
|---|---|---|
| Headless Daemon per Host, Clients attach | ✅ core hypothesis | Zeron, Waku, Arbor, Hadron (all have one) |
| **Remote Linux Host from a Mac via SSH-bootstrapped Daemon** | ✅ M1 | tty7 (for terminals only), Arbor outposts; Zeron and Waku do not bootstrap over SSH |
| Structured Harness drivers (Codex app-server, Claude via ACP/stream-json) **plus** a terminal escape hatch | ✅ | Zeron and Waku (structured), tty7 (terminal); few do both well |
| **Real IDE editor**: LSP on remote Hosts, line-targeted inline chat, in-editor review | ✅ Editor milestone | OxiMux (local LSP only), Vibex (basic file editing); none has inline chat or remote LSP |
| **DAG of Agent Sessions** with evidence and authority-tagged operator messages | ✅ DAG milestone | Runner crews, Hadron merge gate, Farcaster workgraph (all partial) |
| Local-first, no account or cloud needed | ✅ | Waku, tty7, Zeron (local profile); Delta needs Zed Cloud |

**In one line:** Polaris is an **IDE-grade editor plus a structured-harness orchestrator over SSH-reachable Host Daemons**. Existing apps are either orchestrators without an editor (Zeron, Waku, Runner), terminals with agent awareness (tty7, Codux), or a cloud product running its own agent (Delta).

---

## Open questions

1. **Block widgets in the gpui-kit editor.** Should Polaris upstream a block-decoration or inlay API to gpui-kit for inline chat and review comments, or keep a Polaris-owned editor fork? This needs a spike against `crates/base/src/input/base/element.rs`.
2. **Diff view.** Is it a separate virtualized view (the Zeron approach) or a read-only gpui-kit `Editor` with range decorations per hunk? Side-by-side needs two synced editors, which is not supported today.
3. **GPUI pin.** Should Polaris track `gpui-pre` in lockstep with gpui-kit (simplest), or fork GPUI the way every mature app eventually has (webview, platform fixes)? Recording which GPUI patches Zeron, Waku and tty7 carry would show what a fork buys.
4. **Licence.** If Polaris chooses GPL-3.0, Waku, Codux and Farcaster code becomes reusable. If it stays permissive (MIT/Apache), those three are reference only.
5. **Borrowing tty7's daemon.** Should Polaris borrow tty7's daemon crates wholesale (Apache-2.0) as the basis for PTY and SSH in the Polaris Daemon, or only the patterns? This depends on how coupled `tty7-core` is to its UI; I did not assess that.
6. **Remote LSP.** Should language servers run on the Host behind Daemon RPC, with gpui-kit providers forwarding to them, or should the Daemon expose files and the Client run the LSP? No surveyed app does remote LSP.
