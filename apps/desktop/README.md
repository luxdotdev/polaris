# @polaris/desktop

The Electron Desktop App (Electron 44, Chromium 152). The main process runs the Client runtime (`@polaris/client`'s HostRegistry on Effect); the renderer is React 19 with the React Compiler, styled by `@polaris/ui`.

```sh
bun run --cwd apps/desktop dev      # Vite dev server + hot reload; main rebuilt and Electron restarted on change
bun run --cwd apps/desktop build    # out/{main,preload,renderer} and an unpacked out/Polaris.app (macOS)
bun run --cwd apps/desktop start    # electron . against the last build
bun run --cwd apps/desktop smoke    # build, then the end-to-end smoke test (Node; Playwright)
bun run bench desktop-idle          # memory and CPU of the built app, settled (packages/bench)
node scripts/screens.ts <dir>       # screenshots against Paper 11U-0 / MX-0, from four seeded local Daemons
node scripts/sessionScreens.ts --out <dir> [--frames]   # the shell with the session view on fixtures (#preview/<scene>), every theme and density
```

`dev` connects the local Host to `~/.polaris/daemon.sock` when a Daemon answers there; otherwise it starts a dev Daemon from source with its own home and the scripted bench Harness, and keeps it across restarts (ADR 0007). Builds: Vite for the renderer, `Bun.build` for main and preload (ADR 0008).

## Layout

| Path | What |
|---|---|
| `src/shared/contract.ts` | The IPC contract's inputs as Effect Schemas: every request and subscription, decoded in main before anything runs. The renderer imports it for types only. |
| `src/shared/api.ts` | Outputs, feed items, `AppEvent`, channel names and `PolarisApi` (`window.polaris`). Types and constants only. |
| `src/preload/index.ts` | `contextBridge` exposes `PolarisApi`; one listener demultiplexes every subscription's batches. CommonJS, sandboxed. |
| `src/main/index.ts` | App lifecycle, settings, appearance, window, protocol, IPC; prints `polaris: ready` once painted and the local Host is up. |
| `src/main/hosts.ts` | `HostDirectory`: the Hosts on the HostRegistry (added and removed at runtime), and their `HostView`s (Connection States) for the renderers. |
| `src/main/machines/` | `Machines`: remote Hosts by `~/.ssh/config` alias, each one's install flow (probe, one-time approval, install, upgrade), approvals, the Daemon builds, the local Host switch; the `machines` feed (its README). |
| `src/main/ipc/` | `requests.ts` (one handler per method; blobs taken here and sent as bytes), `feeds.ts` (host, session, terminal, files.watch, hosts, machines), `subscriptions.ts` (per window), `batcher.ts` (one IPC message per 4 ms window per window), `install.ts` (`install.ensure`). |
| `src/main/localDaemon.ts` | Which socket the local Host uses; the dev Daemon. |
| `src/main/protocol.ts`, `window.ts`, `menu.ts` | `app://polaris` with a strict CSP, the `hiddenInset` window, the native menu (⌘1–3, appearance, density). |
| `src/main/snapshotCache.ts` | The last synchronized Host snapshots, painted at launch and then revalidated (ENG-175). |
| `src/renderer/store/` | Pure reducers for Host and session feeds (`hostModel.ts`, `sessionModel.ts`), a zustand vanilla store applying one frame's updates at a time (`store.ts`, `frameQueue.ts`). |
| `scripts/` | `build.ts`, `dev.ts`, `smoke.ts` and their helpers. |

## The shell and its slots

The renderer is split into the **shell** (owned by the app shell: layout, selection, keyboard) and **features** that fill its slots. Layout F (ENG-177): title bar, an adaptive top bar, then Input (sidebar, 264px) → Intent (448px) → Output (the rest).

| Folder | What |
|---|---|
| `src/renderer/app/` | The root (`App.tsx`), providers, and `slots.tsx`: the one place features are wired in. |
| `src/renderer/shell/` | Title bar, Workspace bar / machine bar, sidebar (session rows, groups, "Needs you elsewhere"), the columns. |
| `src/renderer/routes/` | Navigation state (mode, Host, Workspace, session, sidebar view, pane), persisted per window; keyboard; the Workspace-switch timer. |
| `src/renderer/features/<name>/` | Features (session view, jump menu, inbox, new session…), each exporting the component for its slot. |

**Slots** (`src/renderer/app/slots.tsx`; each has a placeholder default until its feature lands):

| Slot | Props | Where it renders |
|---|---|---|
| `SessionIntent` | `{ hostKey, sessionId }` | The Intent column, for the selected Agent Session. |
| `SessionOutput` | `{ hostKey, sessionId }` | The Output column, for the same session. |
| `NewSession` | `{ hostKey, workspaceId, onStarted(sessionId), onCancel() }` | Spans Intent + Output while starting a session ("New session", ⌘N, the sidebar +). |
| `NoSession` | `{ hostKey, workspaceId }` | Spans Intent + Output when nothing is selected. |
| `NeedsYouInbox` | none | The sidebar's "Needs you" view (the Sessions / Needs you switch). |
| `JumpMenu` | `{ open, onOpenChange }` | The K jump menu; the shell owns `open` (K, ⌘K, the title bar's jump field). |

To wire a feature: in `slots.tsx`, import its component and replace the default, e.g. `SessionIntent: SessionIntentView` from `../features/session/index.ts`. Slots receive ids, not data: read the store with `useApp(selector)` (Host models, open sessions) and open a session's feed with `useSessionFeed(hostKey, sessionId)` (`src/renderer/shell/hooks.ts`).

**Shell actions** for features (`useShellActions()` from `src/renderer/routes/navigation.ts`): `selectSession({ hostKey, sessionId })`, `selectWorkspace({ hostKey, workspaceId })`, `selectHost(hostKey)`, `openJump()`, `startNewSession()`, `showSidebar("sessions" | "needs-you")`. `useSelection()` returns the current `{ mode, hostKey, workspaceId, sessionId, pane }`.

**Top bar** (`routes/topBar.ts`, ENG-177): the Workspace bar (every shown Workspace on every Host as a chip, ⌃1…⌃9, ⌃0) up to 10 Workspaces; the machine bar (⌃N per machine, the sidebar then groups that machine's sessions by Workspace, three per group then "N more") from 11, back only at 9 (hysteresis); hidden in machine mode with a single machine. Hidden Workspaces (CONTEXT.md: hidden when idle) are left out.

**Keyboard** (`routes/keyboard.ts`): ⌘1/2/3 modes (native menu); ⌃1…⌃0, or ⌥1…⌥0 since macOS may bind ⌃N to Spaces; K (outside text fields) and ⌘K the jump menu; ⌘N a new session. Develop → Start proof session (dev, or a bench-Harness local Daemon) runs the proof flow.

**Workspace switch timing** (`routes/switchTimer.ts`): input event → second animation frame after it, kept in `window.__polaris.switchTimes()`; the smoke test switches 40 times and fails over 100 ms at p95.

**Connection State** stays inline: the Host's row dims only while reconnecting and shows how long; the reason sits in a code well under the sidebar header (to be replaced by `@polaris/ui`'s HostStateCard).

**Session view** (`src/renderer/features/session/`, wired into `SessionIntent`, `SessionOutput` and `NewSession`): the header, the virtualized conversation (Turns streaming live, inline approvals and questions) and the composer (send, steer, stop, attachments, Model) in Intent; the chosen Turn's diff in Output (Changes); the new-session page, whose Harness choice comes from the catalogue and the Host's `harness.availability`. `index.ts` is its interface; pure view models under `model/` are tested. `#preview/<scene>` renders the shell on fixtures (a lazy chunk) for `scripts/sessionScreens.ts`. The smoke test reads its `data-testid`s (`session-state`, `live-item`, `turn-item`, `approval`, `diff-file`, `turn-summary`, `composer-input`, `where-line`, `new-session`).

## The bridge

- **Requests**: `window.polaris.request(method, input)` → `Result` (`{ ok, value }` or `{ ok: false, error: { code, message } }`). Methods: settings, `dispatch` (a Client-generated `commandId`; a refusal's message is the Daemon's reason), files, git, `harness.models`, `harness.availability`, `session.terminalCommand`, terminal, `attachments.stage` (bytes → `withBlob` → stage on one connection), `install.ensure`, the snapshot cache, and dev's `dev.proofWorkspace`.
- **Feeds**: `window.polaris.subscribe(kind, input, { items, end })`. `host` and `session` are the client's resumable feeds, so every window shares one upstream subscription per stream: Snapshot (cached) first, then events, `Delta`s and `ItemProgress` (the app announces `session.live-items`). Feeds bound to one connection (`terminal`, `files.watch`) end when it drops; resubscribe.
- **Batching**: main coalesces every feed's items for a window into one message per 4 ms; the renderer applies them once per animation frame (or every 100 ms while hidden).
- Payloads are structured-clone plain data: class instances lose their prototype, so the renderer types domain values as plain records (`store/plain.ts`).

## Settings

`<userData>/settings.json`: `theme` (`system` | `dark` | `light`), `density` (`calm` | `balanced` | `compact`), `hosts`: `[{ alias, label?, colour?, forwardAgent?, remoteCommand? }]` by `~/.ssh/config` alias (edited from Settings → Hosts), and `local: { enabled }` (this Mac as a Host; on by default). `<userData>/approvals.json` holds the approved Daemon builds per alias. The renderer sets `data-theme` (unset for system) and `data-density` on the root.

Environment: `POLARIS_DESKTOP_EXTRA_HOSTS` (screenshots and tests: `[{ key, label, socket }]`, more Hosts on local sockets), `POLARIS_DESKTOP_LOCAL_LABEL`, `POLARIS_DESKTOP_USER_DATA`, `POLARIS_DESKTOP_HIDDEN=1`, `POLARIS_DESKTOP_LOCAL_SOCKET` (+ `POLARIS_DESKTOP_BENCH_HARNESS=1`), `POLARIS_DESKTOP_DAEMON=system|dev`, `POLARIS_DESKTOP_DAEMON_DIST` (the Daemon builds to upload), `POLARIS_DESKTOP_SSH_HOME` (whose `~/.ssh/config` lists aliases; tests).

## Test from another machine

The Desktop App on your laptop, driving a Mac Studio (or a Linux VM, or a Pi) over SSH.

**Prerequisites**

- The Studio: Remote Login on (System Settings → General → Sharing), and your laptop's key in its `~/.ssh/authorized_keys` (`ssh-copy-id studio`). Polaris never answers a password or 2FA prompt.
- The laptop: a `Host studio` block in `~/.ssh/config` (HostName, User, and IdentityFile or an agent key). Polaris only ever uses the alias. Run `ssh studio true` once to trust its host key (or use "Open in Terminal" on the host-key-unknown card).
- Daemon builds: a packaged app carries them. In dev (`bun run --cwd apps/desktop dev`), the app builds the Studio's platform from source the first time (`bun scripts/build-daemon.ts darwin-arm64`, needs this repo, Bun and, for darwin, `codesign`), or prebuild all with `bun run --cwd apps/daemon build`.
- A Harness on the Studio (Claude Code or Codex), installed and signed in there. Polaris never installs one; Settings → Hosts links its setup docs and hands sign-in to Terminal.

**What to expect**

1. Settings → Hosts → **Add a host**: pick `studio`, name it "Mac Studio", leave agent forwarding off. The row appears and says it's checking.
2. No Daemon there yet: the row expands to the approval card with the platform, version, full SHA-256 and `~/.polaris on studio`. **Approve and install** copies the build over SSH, checks its SHA-256 on the Studio and runs `polaris install` (a LaunchAgent; over SSH with nobody logged in at the console it runs in the user domain, and the row's note says so). Nothing is downloaded on the Studio, and nothing needs sudo.
3. The row turns Connected with the Daemon's version; the Studio's Workspaces appear in the machine bar. Later upgrades install on their own and say so under the row; a reconnect never installs.
4. If something needs you, the row says what inline, with ssh's own line and at most one fix: host key unknown (Open in Terminal) or changed (copy `ssh-keygen -R studio`, never a one-click fix), key refused, daemon not running (Start daemon), older daemon (Upgrade).

The remote command defaults to `~/.polaris/bin/current/polaris bridge` (not on PATH in a non-interactive shell); a row's details can override it.

## Known gaps

- Install progress is per step (checking, copying and checking the SHA-256), not per byte; the client reports no byte progress.
- Terminal hand-offs (Open in Terminal, sign-in) use macOS Terminal through a `.command` file.
- The macOS window closes the app (no dock-only mode yet); no vibrancy.
- The production CSP allows `style-src 'unsafe-inline'` (Radix and sonner inject `<style>` elements); accepted for now, scripts stay `'self'` only.
- The dev server is `http://127.0.0.1:5198` (strict): the `@polaris/ui` gallery holds 5199.
- Navigation persists in `localStorage`, shared by every window of the app; per-window keys come with multiple windows.
- The session view's diff is a lightweight unified renderer (no syntax or word highlights, long lines truncate); Pierre Diffs arrives with Review. Diffs over 4 MB aren't parsed here.
- The conversation shows a session's last 20 Turns (the feed's `turnLimit`); older ones aren't paged in yet. Assistant text is plain (no Markdown yet).
- `@polaris/ui`'s `Row` can't be used with `asChild` (its Slot gets several children), so session rows are `role="button"` divs.
- No Sources chips or per-session age of last activity yet; ages are since the session was created.
