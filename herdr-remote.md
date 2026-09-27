# Research: how herdr does remote Hosts, image paste, and remote file access

Ticket: [ENG-168](https://linear.app/luxdev/issue/ENG-168). Researched 2026-09-27.

Sources: the herdr repo `herdrdev/herdr` (formerly `ogulcancelik/herdr`) at commit
`21d71a0` (main, 2026-09-27). The latest stable tag is `v0.9.1` (`8544776`, 2026-09-16).
Every code link below is pinned to `21d71a0`. The docs cited are the repo's own website
sources (`docs/preview/…` and `docs/next/…`), which are what herdr.dev/docs is built from.

## TL;DR

- **The remote Host runs the same herdr binary as a headless server** (it owns the PTYs, panes and agents). The local herdr is a thin client that draws the UI locally. The multi-machine "saved SSH machines" feature shipped in **0.9.0 (2026-09-07)**. **0.9.1 (2026-09-16)** added `herdr --machine <label>` CLI forwarding and Windows hosts. [changelog]
- **Transport: plain OpenSSH stdio. There is no custom network listener and no auth of herdr's own.** The client binds a private local Unix socket. For each connection it runs `ssh -T <target> herdr --session S remote-client-bridge`, which splices stdin/stdout onto the remote server's local client socket. Over that pipe runs the same length-prefixed bincode protocol used locally. [attach-bridge] [host.rs] [wire]
- **Auth is delegated entirely to OpenSSH**: your `~/.ssh/config`, keys and ssh-agent. Background reconnects use `BatchMode=yes` and `StrictHostKeyChecking=yes`. The saved-machine catalog stores only an ID, label, target, session and enabled flag, with no secrets. Herdr adds `-C` compression, a private `ControlMaster` socket and `ServerAliveInterval=15` keepalives. [ssh-opts] [docs-machines]
- **Disconnect survival comes from the server model, not the transport.** Panes live in the remote server, so dropping SSH just detaches a client (`staged` files are cleaned up and the processes keep running). The client shows cached, dimmed state and reconnects with exponential backoff capped at 2 minutes. A 60 s idle watchdog on the remote bridge process reaps dead bridges without touching panes. Full server restarts fall back to layout snapshots and native agent-session resume. [docs-machines] [remote_bridge] [session-state]
- **Image paste works by staging a file on the Host and pasting its path.** The client catches Ctrl+V (configurable) or an *empty* bracketed paste. It reads the local clipboard image (`osascript` on macOS, `wl-paste`/`xclip` on Linux, PowerShell on WSL and Windows) and sends one `ClientMessage::ClipboardImage { target, extension, data }` of at most 16 MiB. The server writes it to `$TMPDIR/herdr-clipboard-images-<uid>/` (dir `0700`, file `0600`). It then types the **remote path** into the target pane as a bracketed paste, and the agent reads that file. Staged files are deleted when that client disconnects, and anything older than 24 h is swept. [clip-client] [clip-server] [headless-stage]
- **Drag-and-drop of an image file works the same way.** If the pasted text is a single absolute local path ending in png/jpg/gif/webp/bmp, the client reads that file and ships the bytes as a ClipboardImage. [clip-client] [issue-828]
- **"Remote file access" does not exist as a feature.** herdr has no file browser, no general file transfer and no remote FS protocol. Files are reached by running things *on* the Host: panes, agents, server-side plugins, and `worktree create --cwd` with remote paths. The only local-to-remote byte transfer is the image bridge, plus `scp`/stdin streaming of the herdr binary itself during install. [docs-cli-machine] [docs-machines] [attach-install]
- **Licence: Apache-2.0** since commit `cd5ea1be` (2026-07-22). Before that it was AGPL-3.0-or-later plus a commercial licence. Everything at or after that commit (including all remote/multi-machine code) is Apache-2.0, so Polaris can copy code as long as it keeps the licence text and notices. Vendored `portable-pty` is MIT (`vendor/portable-pty/Cargo.toml`); `vendor/libghostty-vt` carries Ghostty's own licence (not checked here). [license-commit] [cargo]
- **What Polaris should take**: the *architecture* (per-Host headless daemon, SSH stdio bridge, delegate auth to OpenSSH, bootstrap the binary over SSH, capability negotiation instead of version lock-step, per-connection ownership of transient files). Small, self-contained pieces such as the clipboard-image staging module and the bridge idle watchdog are worth copying outright with attribution. The wire protocol and UI are tmux-shaped (terminal frames), so Polaris should borrow the ideas rather than the code.

## Details

### 1. What runs on the remote Host

- The Host runs a normal herdr **server** daemon per named session. The server owns panes and processes, and clients attach to it. [concepts]
- The Host also runs short-lived **bridge processes** started by SSH:
  - `herdr --session S remote-client-bridge [--idle-timeout-v1]` is the UI/client stream. It first calls `ensure_remote_server_running()`, which spawns the server daemon if none is listening. It refuses to attach if the running server's `endpoint_protocol_generation` doesn't match. Then it forwards stdio to the server's client socket. [host.rs]
  - `herdr --session S remote-api-bridge` is the JSON control API used by `herdr --machine …` CLI forwarding. `--check` prints `herdr-api-bridge-v1` as a capability probe. [remote.rs] [attach-api]
- **Bootstrap.** The client probes the Host OS and arch with `uname`, with a separate probe for Windows. It then looks for a compatible `herdr` on `PATH` and in the common install paths (Homebrew, mise, Nix, `~/.local/bin`). If none is found, it asks for confirmation and then does one of two things:
  - copies the local binary when the platforms match, or
  - downloads the matching release asset listed in `https://herdr.dev/latest.json`.

  Background reconnects never install or restart anything. [attach-install] [docs-remote]
- **Version skew.** Client and server negotiate an endpoint *generation* (currently 1) plus named capabilities such as `surface_interest` and `health_check`, rather than requiring identical versions. A missing capability disables only the related action. [endpoint] [docs-machines]

### 2. Transport and auth

- **Local side.** `SshStdioBridge::start_command` binds a private local listener (a socket file with restricted permissions). For every accepted local client connection, `bridge_connection` spawns `ssh … -T <target> <remote_command>` with piped stdin/stdout and copies bytes both ways. The local herdr client then connects to that socket as if it were a local server. [attach-bridge] [attach-run]
- **SSH options herdr adds** (`apply_managed_ssh_options` / `apply_noninteractive_ssh_options`):
  - `-C`
  - a generated temp `-F` config that `Include`s the user's config first, so user settings win
  - `-S <private control path>` with `ControlMaster=auto` and `ControlPersist=600`
  - for background connections: `BatchMode=yes`, `NumberOfPasswordPrompts=0`, `StrictHostKeyChecking=yes`, `ConnectTimeout=10`, `ServerAliveInterval=15`, `ServerAliveCountMax=4`

  `[remote].manage_ssh_config = false` opts out of all of this. [ssh-opts] [docs-remote]
- **Wire protocol.** A u32 little-endian length prefix followed by a bincode/serde payload. Frames are capped at 2 MB, or 32 MB for graphics frames. Render encoding is negotiated as either `SemanticFrame` (local) or `TerminalAnsi` (pre-diffed ANSI bytes, used remotely). [wire]
- **Auth.** herdr adds no auth of its own; it relies on OpenSSH plus Unix socket permissions on each end. When a prompt is needed (host key, passphrase, MFA), the machine shows "Attention". You then run `herdr --remote <host>` interactively. Tailscale SSH login URLs are surfaced. [docs-machines] [changelog]
- **ssh-agent forwarding.** This landed on main on 2026-09-21 and is unreleased after v0.9.1. When the user sets `ForwardAgent yes`, each bridge registers its `SSH_AUTH_SOCK` with the server. The server exposes a **stable per-session agent socket path** (`<api socket>.agent`) to panes, so git and signing inside panes keep working across reconnects. [ssh-agent-commit] [docs-next-machines]
- **Multi-machine UI.** Only the *selected* machine streams pane screens. The other machines send workspace, agent-state and notification metadata only (the `surface_interest` capability). [docs-machines]

### 3. How session state survives disconnects

- When the transport drops, the server simply loses a client. `remove_client` drains held input, deletes that client's staged clipboard files and releases terminal-attach ownership. Panes and agents keep running. [headless-remove]
- The client keeps the last workspace and agent state visible but dimmed ("cached, not live") and blocks input until a fresh matching screen arrives. It reconnects with backoff up to 2 min, and a connection must stay healthy for 1 min to reset the fast-retry path. Health probes run when the connection is quiet. [docs-machines]
- The remote bridge process has its own liveness watchdog. It uses a suspend-inclusive clock, and after 60 s with no bytes in either direction it calls `exit(1)`, killing only the bridge. [remote_bridge] [host.rs]
- On a server restart, processes are lost. Layout, cwd and focus return from `session.json`, and there are rolling `session-snapshots/`. Optional pane screen history can be replayed, and agents with integrations resume via native session IDs. An experimental `--handoff` passes live PTYs to a new server binary during upgrades. [session-state]

### 4. Pasting images and photos into a remote agent

The flow, end to end:

1. **Trigger (client).** `should_bridge_clipboard_image_paste` fires only when the client is attached to a remote endpoint and the input is one of:
   - exactly `ESC[200~ESC[201~`, an empty bracketed paste, which is what terminals send on Cmd+V when the clipboard holds only an image, or
   - a single press of `keys.remote_image_paste`, default `ctrl+v`.

   [clip-client] [config-default]
2. **Read (client).** `platform::read_clipboard_image()` reads the image locally:
   - macOS: `osascript` writes `«class PNGf»` to a temp file. [macos-clip]
   - Linux: `wl-paste --type <mime>` or `xclip`. WSL and Windows use PowerShell. [linux-clip]

   The read is capped at 16 MiB (`MAX_CLIPBOARD_IMAGE_PAYLOAD`). [wire]
3. **File drop (client).** If the input is one line holding an absolute path to a png/jpg/gif/webp/bmp file (after un-quoting and un-escaping), the client reads *that local file* instead. This fixed #828, where Finder drops arrived on the remote as local paths it couldn't read. [clip-client] [issue-828]
4. **Send.** One `ClientMessage::ClipboardImage { target: Pane(id) | DirectTerminal, extension, data }`. The server disconnects any client that sends an oversized payload. [clip-client] [transport]
5. **Stage (server).** `clipboard_image::stage` writes to `$TMPDIR/herdr-clipboard-images-<euid>/client-<id>-clipboard-<nanos>-<n>.<ext>`:
   - It uses `create_new` with file mode `0600` and chmods the directory to `0700`.
   - The extension is sanitised against an allow-list; anything unknown becomes `png`.
   - Files older than 24 h are swept on every stage.

   [clip-server]
6. **Inject.** The server writes the staged path to the target pane's PTY, wrapped in bracketed-paste markers if the app enabled bracketed paste (`paste_payload_for_runtime`). The agent (for example Claude Code) sees a pasted file path and attaches the image. [headless-stage] [paste-payload]
7. **Cleanup.** The path is recorded in `client.staged_clipboard_files` and deleted when that client disconnects or the server shuts down. [headless-stage] [headless-remove]

This only works when herdr's client runs locally (`herdr --remote` or saved machines). If you `ssh host` and then run `herdr` there, only terminal text paste works. [docs-remote]

A comment on #828 reports that file drop into a 0.9.0 saved-machine session still pasted a local temp path. That may be a regression in the multi-machine path; it is not verified here. [issue-828]

### 5. Accessing files on a remote Host

- There is no remote file browser, no SFTP-style API and no file sync. Everything that touches Host files runs on the Host:
  - panes, shells and agents
  - server-advertised custom commands and plugins, which "still run there"
  - worktree operations

  [docs-machines]
- `herdr --machine X worktree create --cwd …` requires absolute or `~`-relative remote paths, expanded on the server. Plugin link paths must be absolute. [docs-cli-machine]
- herdr deliberately does **not** copy local config, plugins, executables or secrets to Hosts. [docs-machines]
- The only other file movement is herdr installing itself: `scp` or streaming over stdin to a temp path, then an atomic commit, with a sha256-checked Windows package. [attach-install]
- Third-party plugins such as `persiyanov/herdr-reviewr` (a diff and file viewer) fill the gap as server-side plugins. That is the ecosystem's answer, not a core feature.

## Licence and reuse assessment

- **Licence: Apache-2.0** (`LICENSE`, `Cargo.toml` `license = "Apache-2.0"`). The author relicensed it from AGPL-3.0-or-later plus commercial in `cd5ea1be` (2026-07-22). There is no NOTICE file. Contributions are gated to an approved-contributor list (CONTRIBUTING.md), which is consistent with a clean relicense. [license-commit] [cargo] [contributing]
- Apache-2.0 lets Polaris copy and modify code if it keeps the licence, preserves copyright and attribution notices, and marks modified files. Code from **before** 2026-07-22 is AGPL; take only post-relicense revisions.

| Piece | Reuse as code (with attribution)? | Notes |
|---|---|---|
| `src/server/clipboard_image.rs` (staging, perms, 24 h sweep) | **Yes**, near-verbatim | ~150 lines, no herdr dependencies |
| `src/client/clipboard_images.rs` (trigger and drop-path parsing) | Partially | The trigger logic is terminal-specific. Polaris is a GPUI app and gets image paste from the OS clipboard directly, so only the path parsing and extension allow-list are useful |
| `platform::read_clipboard_image` (osascript / wl-paste / xclip / PowerShell) | Ideas only | GPUI has native clipboard image support, so shelling out isn't needed on the Desktop App |
| `src/platform/remote_bridge.rs` (idle watchdog) + `remote/host.rs` bridge | **Yes** | Small and generic stdio-to-socket splice with a suspend-aware idle timer |
| SSH option set, managed temp config and control socket (`remote/attach.rs`) | Copy the option list; rewrite the rest | attach.rs is 5.4k lines tied to herdr's install and manifest flow |
| `src/platform/ssh_agent.rs` (stable agent socket for panes across reconnects) | **Yes**, strong candidate | Solves a real problem Polaris will hit |
| Wire protocol / render frames | No | Terminal-frame-centric; Polaris's Daemon API is richer (files, LSP, Agent Sessions) |
| Endpoint generation + capability negotiation | Idea | Adopt the pattern, not the code |

## Implications for Polaris's per-Host Daemon design

1. **herdr confirms the CONTEXT.md model.** herdr's server is Polaris's Daemon, its local TUI is the Client, and a saved machine is a Host. The approach is proven in production, and the notable part is doing it over **nothing but OpenSSH**. Polaris can ship remote Hosts without its own auth, TLS or port exposure by tunnelling the Daemon protocol over `ssh -T host polaris-daemon bridge`.
2. **Image paste to remote Agent Sessions = upload + path injection.** Harnesses like Claude Code accept a file path, so the Daemon needs a small `stage_attachment(bytes, ext) -> remote_path` RPC. The staged file belongs to the Client connection or the Agent Session, with `0600` perms and TTL cleanup. Because Polaris owns its own composer (not a PTY), it can pass the path through the Harness's structured input rather than typing it. The same RPC generalises to arbitrary file uploads and drag-and-drop.
3. **Remote file access is Polaris's to design; herdr offers no prior art.** Polaris's Daemon already "owns that Host's files", so it needs a real file API (read, write, watch, and search). This is the main place Polaris goes beyond herdr.
4. **Disconnect semantics to copy:**
   - Daemon-owned processes.
   - Client-side cached, dimmed state with input blocked until resync.
   - Backoff capped at about 2 min.
   - Only the *focused* Host streams heavy content; the others stream metadata.
   - A bridge-side idle watchdog.
   - Background reconnects never install, upgrade or answer prompts; they surface "Attention" instead.
5. **Bootstrap and versioning.** Install the Daemon over SSH with explicit confirmation, detect OS and arch with `uname`, and negotiate capabilities instead of requiring identical versions. Never restart a Daemon (which kills Agent Sessions) without asking, and default to No.
6. **ssh-agent forwarding across reconnects** needs a stable socket indirection owned by the Daemon, or agents' `git push` breaks after every reconnect.

## Open questions

- Does image file drop work in saved-machine mode on current main? The #828 comment reports it doesn't in 0.9.0. Testing would need a remote Host.
- How does herdr's mobile or "switcher" client (the docs mention a mobile switcher) reach Hosts? Probably through the same SSH path, not investigated.
- The Apache-2.0 relicense had no NOTICE file or contributor sign-off record. That is presumably fine given the approved-contributor gate, but if Polaris copies code, confirm the specific files' history is entirely post-2026-07-22 or authored by the maintainer.
- Should Polaris's Daemon transport *also* offer a non-SSH path (for example Tailscale or a direct TLS socket) for the future Mobile App? herdr avoids that path entirely. Some phone clients in herdr's ecosystem (`AltanS/collie`) run their own tailnet PWA instead.

## Citations

[changelog]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/CHANGELOG.md
[attach-bridge]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs#L2640-L2760
[attach-run]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs#L41-L87
[attach-install]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs#L1197-L1300
[attach-api]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs#L2524-L2600
[ssh-opts]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs#L1114-L1173
[host.rs]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/host.rs
[remote.rs]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote.rs#L15-L39
[remote_bridge]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/platform/remote_bridge.rs
[wire]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/protocol/wire.rs#L1-L40
[endpoint]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/protocol/endpoint.rs#L15-L30
[transport]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/client_transport.rs#L1110-L1132
[clip-client]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/client/clipboard_images.rs
[clip-server]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/clipboard_image.rs
[headless-stage]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/headless.rs#L2070-L2105
[headless-remove]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/headless.rs#L905-L925
[paste-payload]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/terminal_attach.rs#L1-L10
[config-default]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/config/model.rs#L1116
[macos-clip]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/platform/macos.rs#L685-L720
[linux-clip]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/platform/linux.rs#L808-L850
[ssh-agent-commit]: https://github.com/herdrdev/herdr/commit/3602c757e07645383dc092f8540dcb72ba0ed49d
[docs-machines]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/preview/website/src/content/docs/connecting-machines.mdx
[docs-next-machines]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/next/website/src/content/docs/connecting-machines.mdx
[docs-remote]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/preview/website/src/content/docs/persistence-remote.mdx
[docs-cli-machine]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/preview/website/src/content/docs/cli-reference.mdx
[session-state]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/preview/website/src/content/docs/session-state.mdx
[concepts]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/docs/preview/website/src/content/docs/concepts.mdx
[license-commit]: https://github.com/herdrdev/herdr/commit/cd5ea1be0e69ed49b6f32f7ed5b333f6c8526874
[cargo]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/Cargo.toml
[contributing]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/CONTRIBUTING.md
[issue-828]: https://github.com/herdrdev/herdr/issues/828

- [changelog] https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/CHANGELOG.md
- [attach-bridge] / [attach-run] / [attach-install] / [attach-api] / [ssh-opts]: https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/attach.rs
- [host.rs] https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/remote/host.rs
- [remote_bridge] https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/platform/remote_bridge.rs
- [clip-client] https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/client/clipboard_images.rs
- [clip-server] https://github.com/herdrdev/herdr/blob/21d71a0308c3df7053f9fc281ad4943d1c89d1a3/src/server/clipboard_image.rs
- [license-commit] https://github.com/herdrdev/herdr/commit/cd5ea1be0e69ed49b6f32f7ed5b333f6c8526874
- [ssh-agent-commit] https://github.com/herdrdev/herdr/commit/3602c757e07645383dc092f8540dcb72ba0ed49d
- [issue-828] https://github.com/herdrdev/herdr/issues/828
