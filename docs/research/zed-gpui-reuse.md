# Research: reusing Zed and GPUI

Linear: [ENG-172](https://linear.app/luxdev/issue/ENG-172) (under map ENG-167). Researched 2026-09-27.

All repo citations are pinned to zed-industries/zed commit `e683fd7b465ecfb42b1da88ff685d204c2781076` (main, 2026-09-27). `Z` below means `https://github.com/zed-industries/zed/blob/e683fd7b465ecfb42b1da88ff685d204c2781076`.

## TL;DR

- **GPUI and its platform crates are Apache-2.0.** The GPL-free part is bigger than you might expect: `gpui`, `gpui_platform`, `gpui_macos`, `gpui_linux`, `gpui_wgpu`, `gpui_tokio`, `sum_tree`, `collections`, `util`, `http_client`, `scheduler`, `refineable` and a few more (34 crates in total). Their workspace dependency closure contains **no GPL crates**. You can use GPUI in a project under any licence.
- **Every crate Polaris would want beyond GPUI is GPL-3.0-or-later.** That covers `editor`, `multi_buffer`, `text`, `rope`, `project`, `language`, `lsp`, `git`, `git_ui`, `terminal`, `terminal_view`, `remote`, `remote_server`, `agent`, `agent_ui`, `acp_thread`, `agent_servers`, `edit_prediction*`, `workspace`, `ui` and `theme` (205 of 239 crates). Using any of them makes the Polaris binary GPLv3. This is only a problem if Polaris ever needs a non-GPL licence. (The standalone `zeta`/`zeta2` crates no longer exist; what's left is `edit_prediction*` plus `zeta_prompt`.)
- **The GPL crates don't come apart cleanly.** `editor` pulls in 98 workspace crates, including `workspace`, `project`, `client`, `rpc`, `telemetry` and `db`. `agent_ui` pulls in 154. `remote_server` pulls in 106. `terminal` is the exception: its direct dependencies are small. Vendoring "just the editor" in practice means vendoring most of Zed.
- **GPUI works standalone, but crates.io is not the real distribution channel.** The official `gpui` crate is stuck at 0.2.2 (2025-10-22). The repo README now tells you to depend on `gpui_platform`, which has never been published. Real apps use a git revision of Zed, a community republish (`gpui-pre` 0.3.6, weekly snapshots published by the gpui-component author), or the `gpui-ce` fork. The API is explicitly pre-1.0 with "often breaking changes".
- **GPUI supports macOS (Metal) and Linux (Wayland and X11, rendering via wgpu/Vulkan).** Both are the defaults. Windows and web backends also exist.
- **Zed's `remote_server` is a headless GPUI app running Zed's `project` crate on the remote host.** It speaks length-prefixed protobuf `Envelope`s over three Unix sockets (stdin/stdout/stderr), which are proxied through an SSH ControlMaster. It runs one daemon per workspace, it must match the client's version exactly, and it exits after 10 minutes with no connection. It already hosts ACP agent servers (`AgentServerStore`) remotely.
- **Its design suits a Polaris Daemon: the transport, reconnection and daemon patterns carry over well; the process model does not.** It is a per-workspace, version-locked, single-client-at-a-time mirror of Zed's `Project`, not a long-lived multi-client per-host daemon. Reusing it as-is ties the daemon protocol to Zed's `proto` crate (GPL).
- **Upstream moves fast.** About 8,750 commits on main in the last year (428 in the last 30 days), weekly releases (v1.21.0 on 2026-09-23) and a CLA-gated upstream. In the last 30 days, `crates/gpui` saw 56 commits, `editor` 50, `agent_ui` 41, `project` 37. One visible downstream Zed fork (`egoist/zed`, used by Waku) is 20 commits ahead and 647 behind.
- **Standalone GPUI apps are now common, and many are direct Polaris competitors.** Examples include Arbor, Waku, Zeron, OxiMux, Hadron, Runner, Vibex, Farcaster and tty7, plus **Delta**, "a multiplayer environment for coding with agents, built by the creators of Zed". Longbridge's `gpui-kit`/`gpui-component` (Apache-2.0) ships an Apache-licensed code editor with Tree-sitter highlighting and LSP support.
- **Recommendation for the map:** option (b) or (c). Build a new GPUI app, decide the licence first, and treat Zed's GPL crates as optional, vendored and pinned. Don't do a full fork.

## Crate licence table

Source for each row: `Z/crates/<crate>/Cargo.toml` (the `license` field) and the `LICENSE-*` file in that crate directory. Every crate sets `publish.workspace = true` or `publish = false`. The workspace default is `publish = false` (`Z/Cargo.toml` line 272), so only `gpui` sets `publish = true` (`Z/crates/gpui/Cargo.toml`). Root licences: `Z/LICENSE-APACHE`, `Z/LICENSE-GPL`. There is no AGPL file any more, and `collab` is also GPL-3.0-or-later. Across all crates: 34 are `Apache-2.0` and 205 are `GPL-3.0-or-later`.

| Area | Crate(s) | Licence | Workspace crates in dependency closure (GPL count) |
|---|---|---|---|
| UI framework | `gpui` (v0.2.2, `publish = true`) | Apache-2.0 | 16 (0 GPL) |
| Platform backends | `gpui_platform`, `gpui_macos`, `gpui_apple`, `gpui_linux`, `gpui_wgpu`, `gpui_windows`, `gpui_web`, `gpui_macros`, `gpui_tokio`, `gpui_util`, `gpui_shared_string` | Apache-2.0 | `gpui_platform`: 23 (0 GPL) |
| Data structures / utils | `sum_tree`, `collections`, `util`, `util_macros`, `refineable`, `scheduler`, `http_client`, `reqwest_client`, `watch`, `zlog`, `ztracing` | Apache-2.0 | |
| Text / buffers | `text`, `rope`, `multi_buffer`, `buffer_diff` | GPL-3.0-or-later | |
| Editor | `editor` | GPL-3.0-or-later | 98 (74 GPL) |
| Project model | `project`, `worktree`, `fs` | GPL-3.0-or-later | `project`: 80 (56 GPL) |
| Language / LSP | `language`, `languages`, `lsp` | GPL-3.0-or-later | |
| Git | `git`, `git_ui` | GPL-3.0-or-later | `git_ui`: 112 (88 GPL) |
| Terminal | `terminal`, `terminal_view` | GPL-3.0-or-later | `terminal_view`: 99 (75 GPL) |
| Remote | `remote`, `remote_server`, `rpc`, `proto` | GPL-3.0-or-later | `remote_server`: 106 (74 GPL) |
| Agent / ACP | `agent`, `agent_ui`, `agent_servers`, `agent_settings`, `acp_thread`, `acp_tools` | GPL-3.0-or-later | `agent_ui`: 154 (121 GPL); `acp_thread`: 89 (65 GPL) |
| Edit prediction | `edit_prediction`, `edit_prediction_context`, `edit_prediction_ui`, `edit_prediction_types`, `zeta_prompt` (no `zeta`/`zeta2` crates at this commit) | GPL-3.0-or-later | `edit_prediction`: 102 (78 GPL) |
| Shell / components | `workspace`, `ui`, `theme`, `settings` | GPL-3.0-or-later | `ui`: 23 (7 GPL) |
| Whole app | `zed` | GPL-3.0-or-later | 230 (197 GPL) |
| External protocol | `agent-client-protocol` =2.2.0 (crates.io, from `agentclientprotocol/rust-sdk`) | Apache-2.0 | n/a |

Method for the closure column: I walked each crate's `[dependencies]` and target-specific dependencies, restricted to workspace members, using a Python script over the `Cargo.toml` files in the clone. Dev-dependencies are excluded, and third-party crates are not counted.

Notes:
- Zed's own statement: "licensed primarily under GPL-3.0-or-later, with Apache-2.0 components where marked" (`Z/README.md`, "Licensing"). Upstream contributions require the CLA (`Z/CONTRIBUTING.md`, which links https://zed.dev/cla).
- `editor`'s direct dependencies include `client`, `rpc`, `telemetry`, `db`, `workspace`, `project`, `dap`, `feature_flags` and `vim_mode_setting` (`Z/crates/editor/Cargo.toml`). `multi_buffer` alone is lighter: `buffer_diff`, `clock`, `language`, `rope`, `settings`, `sum_tree`, `text`, `theme`, `util` (`Z/crates/multi_buffer/Cargo.toml`). `terminal` depends only on `collections`, `gpui`, `release_channel`, `settings`, `task`, `theme`, `theme_settings` and `util` (`Z/crates/terminal/Cargo.toml`).
- Even Zed's component library (`ui`) is GPL. A permissive Polaris would need its own components or Longbridge's Apache-2.0 `gpui-component`.

## GPUI standalone viability

**Licence and packaging.** `gpui` is `license = "Apache-2.0"`, `publish = true`, version `0.2.2`, homepage https://gpui.rs (`Z/crates/gpui/Cargo.toml`). Its default features are `font-kit`, `wayland`, `x11` and `windows-manifest`.

**Stability.** The README says: "GPUI is still in active development as we work on the Zed code editor, and is still pre-1.0. There will often be breaking changes between versions. You'll also need to use the latest version of stable Rust" (`Z/crates/gpui/README.md`). `crates/gpui` received 56 commits in the 30 days to 2026-09-27 (GitHub commits API, `path=crates/gpui`).

**crates.io state** (from `https://crates.io/api/v1/crates/<name>`, queried 2026-09-27):
- `gpui`: max 0.2.2, published 2025-10-22, owners `maxbrunsfeld`, `mikayla-maki`, `MrSubidubi`, `github:zed-industries:crates-io`. It is roughly 11 months stale.
- `gpui_platform`: "crate does not exist". The current README still says to add `gpui_platform = { version = "*", ... }` and start apps with `gpui_platform::application()` (`Z/crates/gpui/README.md`). **You cannot build the current API from crates.io alone.**
- `gpui-pre`: 0.3.6, published 2026-09-21 by `huacnlee` (the gpui-component author), described as "gpui-pre snapshot of zed@bcf6582". Snapshots come out weekly (0.3.3 through 0.3.6 were published between 2026-09-03 and 2026-09-21). `gpui-kit` pins `gpui = { package = "gpui-pre", version = "=0.3.6" }` (https://github.com/longbridge/gpui-kit/blob/main/Cargo.toml).
- `gpui-ce` ("GPUI – Community Edition", https://github.com/gpui-ce/gpui-ce): Apache-2.0, 1.1k stars, pushed 2026-09-27. Its README says it is "mostly API compatible, but this is changing!"

**Platforms.**
- macOS: Metal rendering. Glyph rasterisation needs the `font-kit` feature. Xcode is required (`Z/crates/gpui/README.md`).
- Linux/FreeBSD: "enable at least one windowing backend … `wayland`, `x11`, or both" (`Z/crates/gpui/README.md`). `gpui_linux` defaults to `["wayland", "x11"]`, and both features pull in `gpui_wgpu` (`Z/crates/gpui_linux/Cargo.toml`). Zed on Linux needs a Vulkan-capable GPU (`Z/docs/src/linux.md`, "Zed requires a GPU … we use Vulkan"), and the doc lists several driver pitfalls (amdvlk and others).
- Windows (`gpui_windows`) and web/wasm (`gpui_web`) backends also exist (`Z/crates/`).

**Evidence of standalone use.** zed-industries/awesome-gpui (https://github.com/zed-industries/awesome-gpui, README) lists dozens of apps. Ones relevant to Polaris:
- Agent orchestrators and IDE-likes: Arbor ("agentic coding workflows … Git worktrees, terminals, and diffs", 830★), Waku (local coding agents, 1.5k★), Zeron (controls coding agents across devices, 2.2k★), OxiMux (multi-agent worktree cockpit), Hadron (agent swarm per worktree with a merge gate), Runner, Vibex (ACP-compatible agents plus a mobile client), Farcaster, Rabbitty, Codux ("desktop, mobile, and headless hosts"), and **Delta**. https://delta.dev describes Delta as "a multiplayer environment for coding with agents, built by the creators of Zed".
- Daemon-backed terminal: tty7 (1.1k★, "a persistent daemon holds the PTYs so sessions survive quitting the app").
- Commercial: Longbridge Pro, built on gpui-kit (https://github.com/longbridge/gpui-kit README).
- How they depend on GPUI varies, which shows the distribution problem:
  - Arbor: `gpui = "0.2.2"` from crates.io (MIT licence).
  - Waku: `gpui`/`gpui_platform` from a git fork, `egoist/zed` branch `waku-webview` (GPL-3.0).
  - Zeron: a git rev of its own `zeronsh/zui` fork (MIT).
  - GitComet: `gpui-ce` from git (AGPL-3.0).
  - tty7: `gpui_platform` plus `gpui-component` (Apache-2.0).
  
  (Each project's root `Cargo.toml` and GitHub licence metadata, fetched 2026-09-27.)

**Longbridge `gpui-kit` / `gpui-component`** (Apache-2.0, 14.9k★, crates.io 0.6.6 on 2026-09-21) offers 75+ components, dock layout, virtual lists and data tables. It also includes a "**Code Editor**: Stable performance at 200K lines with Tree-sitter highlighting and LSP diagnostics, completion, and hover" (repo README). That makes it a permissive substitute for part of Zed's `editor`. It does not include multibuffer, Vim mode or collaboration.

## remote_server architecture

Sources: `Z/docs/src/remote-development.md`, `Z/crates/remote_server/src/{main.rs,server.rs,headless_project.rs}`, `Z/crates/remote/src/{protocol.rs,remote_client.rs,transport/*.rs}`.

- **Split of responsibilities.** The local machine runs the UI, LLM calls, Tree-sitter parsing and highlighting, and unsaved-buffer storage. The remote runs "source code, language servers, tasks, and the terminal". The Agent Panel works in remote sessions (docs, "Overview").
- **Bootstrap.**
  1. Zed shells out to the system `ssh` and opens a ControlMaster, one per project.
  2. It checks `~/.zed_server` for `zed-remote-server-{channel}-{version}`, whose "version must exactly match the version of Zed itself".
  3. If the binary is missing, it downloads it from zed.dev, or uploads it over SSH when `upload_binary_over_ssh` is set.
  4. Official Linux builds are static musl (docs, "Initializing the remote server").
- **Process model.** `remote_server` has `run`, `proxy` and `version` subcommands, plus hidden `--askpass`, `--crash-handler` and `--printenv` modes (`main.rs`). Each SSH session runs the binary in **proxy mode**, which "will start the daemon if it is not running, and reconnect to it if it is" (docs, "Maintaining the SSH connection"). The daemon writes `server.pid` and binds three Unix sockets, `stdin.sock`, `stdout.sock` and `stderr.sock`, under `remote_server_state_dir()/<identifier>` (`server.rs` `ServerPaths::new`). The identifier is per client workspace: `"{channel}workspace-{workspace_id}"` or `"setup-{id}"` (`remote_client.rs` ~L368-375). **So there is one daemon per open workspace, not one per host.**
- **Lifetime.** `IDLE_TIMEOUT = 10 * 60` seconds: "If no connection comes in this timeout, the server will shut down" (`server.rs` `start_server`). The accept loop handles one stdin/stdout/stderr triple at a time. When reconnecting, the proxy's exit code tells the client whether it must respawn the server (`main.rs` comment).
- **Wire protocol.** Messages are a little-endian `u32` length followed by a protobuf `rpc::proto::Envelope` (`remote/src/protocol.rs`). This is the same `proto`/`rpc` layer Zed uses for collaboration (GPL). The stderr socket carries server logs back to the client.
- **What runs server-side.** `remote_server` is itself a headless GPUI `App`: it depends on `gpui`, `gpui_platform` and `gpui_tokio` (`Z/crates/remote_server/Cargo.toml`). It hosts a `HeadlessProject` built from `project` stores (worktrees, buffers, `LspStore`, `PrettierStore`, git, tasks/DAP, extensions) with 43 request handlers (`headless_project.rs`). It also runs `AgentServerStore` and `AgentRegistryStore`, shared under `REMOTE_SERVER_PROJECT_ID`, so **ACP agent servers are spawned on the remote host** (`headless_project.rs` ~L236-291, 341).
- **Transports.** `remote/src/transport/` contains `ssh.rs`, `wsl.rs`, `docker.rs` and `mock.rs`. The docs list supported hosts as macOS Catalina+, Linux x86_64/arm64 and Windows.

**Fit as a Polaris Daemon.** The requirement is per host, macOS and Linux, and presumably long-lived and shared across windows or agents.

- It **already runs on macOS and Linux** and already hosts ACP agents, terminals, git and LSP remotely. That is close to Polaris's needs.
- It conflicts with a per-host daemon in these ways:
  - it is scoped to one workspace;
  - it serves one client connection at a time;
  - it exits after 10 idle minutes (an orchestrator wants agents to keep running with no UI attached);
  - it is locked to the exact client version, so every UI upgrade redeploys the daemon;
  - its protocol is Zed's full `proto` schema, coupled to `project`'s entity model.
- What carries over as design, whether or not code is reused:
  - SSH ControlMaster multiplexing;
  - "proxy spawns or attaches to the daemon" via pid file plus Unix sockets;
  - uploading a version-matched static-musl binary over SSH;
  - forwarding askpass through a Unix socket;
  - streaming logs over a side channel;
  - exit-code signalling for reconnection.
- Reusing the code (the `remote` plus `remote_server` closure is about 106 crates) makes the daemon GPL and effectively a Zed `Project` server. Polaris would then inherit Zed's weekly protocol churn.

## Fork cost

- **Velocity.**
  - GitHub search counts 8,748 commits on main between 2025-09-27 and 2026-09-27, and 428 in 2026-08-27..2026-09-27.
  - Per-path counts for the last 30 days: `gpui` 56, `editor` 50, `agent_ui` 41, `project` 37, `git_ui` 23, `ui` 19, `workspace` 17, `acp_thread` 13, `remote_server` 12, `remote` 6, `terminal` 5.
  - Releases are weekly, stable plus `-pre` (v1.19.2 through v1.22.0-pre between 2026-09-09 and 2026-09-23, from the GitHub releases API).
  - The repo has 91k★, 10.8k forks, 239 crates and about 4.3k files (clone).
- **Monorepo coupling.** Crates share one workspace version and many `workspace = true` dependencies (`Z/Cargo.toml` `[workspace.dependencies]`). Several dependencies are Zed-maintained git forks, such as `zed-font-kit` via a git rev in `Z/crates/gpui/Cargo.toml`, and `zed-reqwest`/`zed-scap` (`Z/Cargo.toml` "WARNING: … publish a new version of zed-reqwest"). Pulling a single crate means pulling its whole workspace closure (see the table above), so a fork effectively means a fork of the workspace.
- **Real-world drift.** `egoist/zed` branch `waku-webview` (the GPUI source for Waku) is **20 ahead and 647 behind** zed main (GitHub compare API, 2026-09-27). Small, focused forks already fall hundreds of commits behind. Community projects (`gpui-ce`, `gpui-pre`) exist precisely to absorb this churn.
- **Rough cost estimate** (my inference, not a sourced figure):
  - A GPUI-only dependency pinned to a git rev or `gpui-pre`: a few hours per bump when you choose to bump, and you can bump rarely.
  - Vendoring editor, project and the rest: each bump means rebasing Polaris changes across roughly 100 crates that see around 400 commits a month, which realistically takes days per month of upstream.
  - A full Zed fork with product changes to `workspace` and `agent_ui`: close to a permanent part-time job, and any upstream contribution needs the CLA.

## Options

### (a) Fork Zed (a Polaris-flavoured Zed)
- **Pros:**
  - A best-in-class editor, multibuffer, LSP, git UI, terminal, debugger and ACP agent panel on day one.
  - Remote dev over SSH, WSL and Docker already works on macOS and Linux.
- **Cons:**
  - The whole product is GPLv3.
  - Polaris's orchestrator-first UX has to be retrofitted into Zed's `workspace` and `agent_ui`, which are among the fastest-moving crates.
  - The remote daemon model (per workspace, idle exit, version-locked) doesn't match per-host orchestration.
  - Maximum sync burden (about 8.7k commits a year).
  - You end up competing with Zed and Delta on their own codebase.
- **Choose if:** Polaris is fundamentally "Zed plus an orchestrator" and GPL is fine.

### (b) New GPUI app, optionally vendoring selected Zed crates
- **Pros:**
  - Polaris owns its shell, domain model and daemon.
  - It can depend on specific Zed crates such as `terminal` (light), `multi_buffer`/`text`/`language`/`lsp`, or even `editor` behind a pinned git rev, and only when their value justifies it.
  - Bumps happen on Polaris's schedule.
- **Cons:**
  - Any GPL crate makes the binary GPLv3, so the licence decision comes first.
  - `editor` in practice drags in `workspace`, `project`, `client`, `rpc` and more (98 crates), so "just the editor" is a large, leaky dependency that expects Zed's `Workspace` and `Project`.
  - You write your own daemon.
- **Choose if:** Polaris wants Zed-quality editing but its own architecture, and accepts GPL (or accepts it only for optional features).

### (c) GPUI only (Apache), plus permissive ecosystem crates
- **Pros:**
  - Licence freedom (MIT, Apache or GPL all possible later).
  - The smallest upstream surface: only `gpui*`, which still churns (56 commits a month) but can be pinned to a git rev, `gpui-pre` or `gpui-ce`.
  - `gpui-kit`/`gpui-component` provide docks, lists and an LSP-capable code editor.
  - `alacritty_terminal` (which Zed's `terminal` wraps) can be used directly.
  - ACP comes via the Apache `agent-client-protocol` crate.
  - The Polaris Daemon is designed from scratch, borrowing remote_server's patterns.
- **Cons:**
  - Polaris builds its own multibuffer, diff and review views, git UI and agent thread UI.
  - The editor will lag Zed's (no Vim mode, no multibuffer, weaker performance edges).
  - The crates.io `gpui` is stale, so you depend on a git rev or a community republish anyway.
- **Choose if:** Polaris's core value is orchestration and review rather than being the best text editor, or if a permissive licence matters.

## Open questions

1. What licence will Polaris use if it is open-sourced? This single decision gates (a) and (b) against (c).
2. How much of the editing experience must be Zed-grade? Would a gpui-component editor, or opening the file in the user's editor, be enough for reviewing agent diffs?
3. Could Polaris compose `multi_buffer` plus `editor` without Zed's `Workspace` and `Project`? That needs a spike: build a minimal binary that depends only on `editor` and count what must be initialised.
4. How will the GPUI version be pinned: a Zed git rev, `gpui-pre`, or `gpui-ce`? How far is `gpui-ce` diverging, and does Zed intend to resume crates.io releases (and publish `gpui_platform`)?
5. Daemon protocol: design a Polaris-native, versioned protocol (so UI and daemon can skew), rather than Zed's lock-step `proto`. Should the daemon be multi-client, as tty7's persistent-PTY daemon suggests?
6. Positioning: how does Polaris differ from Delta (by Zed's creators) and the dozen GPUI agent orchestrators already listed on awesome-gpui?
