# @polaris/desktop

The Electron Desktop App (Electron 44, Chromium 152). The main process runs the Client runtime (`@polaris/client`'s HostRegistry on Effect); the renderer is React 19 with the React Compiler, styled by `@polaris/ui`.

```sh
bun run --cwd apps/desktop dev      # Vite dev server + hot reload; main rebuilt and Electron restarted on change
bun run --cwd apps/desktop build    # out/{main,preload,renderer} and an unpacked out/Polaris.app (macOS)
bun run --cwd apps/desktop start    # electron . against the last build
bun run --cwd apps/desktop smoke    # build, then the end-to-end smoke test (Node; Playwright)
node scripts/samePrompt.ts [--build] [--screenshots <dir>]   # two sessions, same prompt, one Workspace: in place, then on two new worktrees
node scripts/budgets.ts [--json <path>] [--markdown <path>]   # the M1 budgets (memory, Workspace switch, frames); CI runs it under Xvfb
bun run bench desktop-idle          # memory and CPU of the built app, settled (packages/bench)
node scripts/screens.ts <dir>       # screenshots against Paper 11U-0 / MX-0, from four seeded local Daemons
node scripts/sessionScreens.ts --out <dir> [--frames]   # the shell with the session view on fixtures (#preview/<scene>), every theme and density
node scripts/needsYouScreens.ts --out <dir>   # the Needs You inbox and hover card on fixtures (#needs-you/<scene>) against Paper 1G2-0 / 1-0
node scripts/emptyScreens.ts --out <dir> [--build]      # the empty states and the terminal drawer from a fresh Daemon, every theme and density
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
| `src/main/protocol.ts`, `window.ts`, `menu.ts` | `app://polaris` with a strict CSP, the `hiddenInset` window, the native menu (Settings… ⌘,, ⌘1–3, appearance, density). |
| `src/main/snapshotCache.ts` | The last synchronized Host snapshots, painted at launch and then revalidated (ENG-175). |
| `src/main/notifications/`, `src/main/tray/` | Needs You outside the window: native notifications (`plan.ts` decides, tested), the menu bar star with the count and a menu of waiting sessions, the Dock badge. Fed by the renderer's `needsYou.publish`. |
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
| `NoSession` | `{ hostKey, workspaceId }` | Spans Intent + Output when nothing is selected (`features/empty`'s `WorkspaceStage`). |
| `NeedsYouInbox` | none | The sidebar's "Needs you" view (the Sessions / Needs you switch). |
| `JumpMenu` | `{ open, onOpenChange }` | The K jump menu; the shell owns `open` (K, ⌘K, the title bar's jump field). |
| `NeedsYouHover` | `{ hostKey, sessionId?, workspaceId?, children }` | Wraps a session row, or a Workspace chip, that needs you with its hover card. |
| `SettingsHosts` | `{ adding }` | Settings → Hosts (Paper S4), for features/machines; centres its own 680px column. |
| `HarnessTerminal` | `{ hostKey, argv, onExit, onClose }` | Settings → Harnesses' "Sign in in terminal": the Harness's own sign-in on its Host (`features/terminal`'s xterm view). |

To wire a feature: in `slots.tsx`, import its component and replace the default, e.g. `SessionIntent: SessionIntentView` from `../features/session/index.ts`. Slots receive ids, not data: read the store with `useApp(selector)` (Host models, open sessions) and open a session's feed with `useSessionFeed(hostKey, sessionId)` (`src/renderer/shell/hooks.ts`).

**Shell actions** for features (`useShellActions()` from `src/renderer/routes/navigation.ts`): `selectSession({ hostKey, sessionId })`, `selectWorkspace({ hostKey, workspaceId })`, `selectHost(hostKey)`, `openJump()`, `startNewSession()`, `showSidebar("sessions" | "needs-you")`, `openSettings(section?, { adding? })`, `closeSettings()`. `useSelection()` returns the current `{ mode, hostKey, workspaceId, sessionId, pane, settings }`; `settings` is `{ section, adding }` while Settings is open.

Settings adds `settings.open` (⌘,, shown in the app menu as Settings…) and `settings.<section>` to the keymap, handled by `settingsCommands` (`features/settings`) and listed by the K menu.

**Settings** (`src/renderer/features/settings/`, DESIGN.md Settings, Paper S1–S4): replaces the three zones below the title bar; ⌘, (the `settings.open` command, also Polaris → Settings…), the gear at the right of the sidebar's footer, or the K menu open it, esc (outside an open menu or dialog) closes it. Sections: Appearance, Harnesses, Usage, and Hosts (the `SettingsHosts` slot). `useSessionDefault(harness)` (from `features/settings/index.ts`) is what a new session of that Harness starts with; the new-session page applies it.

**Top bar** (`routes/topBar.ts`, ENG-177): the Workspace bar (every shown Workspace on every Host as a chip, ⌃1…⌃9, ⌃0) up to 10 Workspaces; the machine bar (⌃N per machine, the sidebar then groups that machine's sessions by Workspace, three per group then "N more") from 11, back only at 9 (hysteresis); hidden in machine mode with a single machine. Hidden Workspaces (CONTEXT.md: hidden when idle) are left out.

**Keyboard and commands.** Every shortcut is one row in `src/shared/keymap.ts` (id, title, accelerators, menu). The renderer's registry (`routes/commands.ts`) runs commands by id; the shell registers its handlers in `shell/commands.ts`, and a feature can take a command over while mounted with `useCommands().register({ "session.interrupt": { run, enabled } })` (the latest registration wins until removed). The native menu (View, Go, Session, Help) is built from the same table: its accelerators are shown but not registered, so key presses reach the renderer, the one handler, and a menu click sends `{ kind: "command", id }`. `routes/keyboard.ts` adds ⌃1…⌃0 / ⌥1…⌥0 (Workspace chips or machines). Bare keys (K, ?) never fire while typing. The shell's overlays (jump menu, shortcut help) are one at a time, render only while open, and Escape closes them from state in the window capture phase: Radix's layer stack is stale while one dialog fades out and the next registers, so a fast Esc could otherwise go to the closing dialog and leave the new one open. `shared/keymap.test.ts` checks for duplicate chords, reserved macOS/Electron chords (⌘Q, ⌘W, ⌘H, ⌘M, ⌘,, ⌘⇧3/4/5, ⌘⇧/ …) and the ⌃/⌥ digits.

| Keys | Command |
|---|---|
| ⌘1 / ⌘2 / ⌘3 | Orchestrate / Review / Edit |
| ⌘K, K | Jump menu |
| ⌃1…⌃0, ⌥1…⌥0 | Workspace chip (Workspace bar) or machine (machine bar) |
| ⌥⌘↓ / ⌥⌘↑ | Next / previous session in the sidebar |
| ↑ / ↓ on a session row | Move between rows; ↵ opens |
| ⌘N | New session |
| ⌘L | Focus the composer |
| ⌘. | Stop the Turn in flight (esc in the composer too) |
| ⇧⌘A / ⇧⌘D | Approve / deny the selected session's oldest pending approval |
| ⌘/, ? | Keyboard shortcuts |

**Jump menu** (`features/jump/`, Paper AR-0): across every Host, Agent Sessions (title, Workspace, Host, state, Harness), Workspaces, Worktrees, machines and actions (new session, open in terminal, archive, views, theme, shortcuts). With no query: Recent, Needs you, Actions; with one: Sessions (Needs You first), Workspaces, Worktrees, Machines, Actions, ranked by `ranking.ts` (prefix > word start > scattered letters, which count only in titles and for 3+ letters). ↵ opens, ⌘↵ opens in Review. Results follow live state.

**Workspace switch timing** (`routes/switchTimer.ts`): input event → second animation frame after it, kept in `window.__polaris.switchTimes()`; the smoke test switches 40 times and fails over 100 ms at p95.

**Budgets** (`scripts/budgets.ts`, CI job `desktop-budgets` under `xvfb-run`): the built app against a Daemon on the bench Harness. It seeds a heavy session (25 Turns × 60 items × 6 KB, 3 files per Turn) and two light Workspaces, then fails when:
- the app's process tree plus the Daemon's reach 1 GB (peak footprint over 3 s, sampled by `@polaris/bench`'s sampler in `scripts/lib/sampleTree.ts` under Bun; on Linux footprint is RssAnon + RssShmem);
- a Workspace switch between two ordinary Workspaces has p95 ≥ 100 ms;
- while streaming, frame p95 is over 1.5 display refresh intervals or more than 2% of frames take over two, relative to the idle median interval, so a 120 Hz Mac is held to ~8.3 ms and Xvfb (60 Hz) to ~16.7 ms;
- the idle interval is over 34 ms: frames are throttled (Linux runs a hidden window at 1 Hz, so on Linux the window is shown; Xvfb keeps it off-screen) and can't be judged.
The switch into and out of the heavy session is measured and reported, not gated: about 20 ms on a Mac today.

**Onboarding** (`src/renderer/features/onboarding/`, DESIGN.md Onboarding): O1 Welcome replaces the whole window until "Get started" (↵), which sets `welcomeSeen` in the settings; the Orchestrator's stage is the O2 setup (`features/empty`'s `HostStage`, with onboarding's native folder picker, ⌘O and an unlocked Start session) whenever the selected Host has no Workspace, and an empty scene (`WaitingStage`) until some Host has said what it holds, so the setup never flashes. `startNewSession` (sidebar +, title bar, ⌘N, the K menu) with no Workspace asks `createNavigation`'s `ensureWorkspace`, which registers the Host's home directory (`HostInfo.homeDir`) as the Workspace "home", or shows it again if hidden, then opens New session in it. Features use `useEnsureWorkspace()` for the same. `model.ts` (stage, found-on-this-Mac lines) and `ensureWorkspace.ts` are tested; the smoke test walks O1 → O2 → Start session → New session in "home".

**Connection State** stays inline: the Host's row dims only while reconnecting and shows how long; the reason sits in a code well under the sidebar header (to be replaced by `@polaris/ui`'s HostStateCard).

**Harness picker** (`src/renderer/features/harness/`): which Harnesses a Host has, live (`harness.availability` feed over `harness.watchAvailability`), and the picker every composer, the new-session page and Fork use. Pickers list only Harnesses that are ready or need sign-in; the rest are under "Other harnesses", an availability sheet with each one's setup line and docs link (Polaris never installs a Harness). Needs sign-in runs the Harness's own `signInArgv` in a Polaris terminal and probes again when it exits. The chip's menu holds the Models (`harness.models`, with refresh; a concrete effort always sent, medium when the Harness gives no default), Fork on another Harness, and the Plan Limits (`plan-limits` feed over `usage.watch`).

**Needs You** (`src/renderer/features/needs-you/`, wired into `NeedsYouInbox` and `NeedsYouHover`, with `NeedsYouPublisher` mounted in `App.tsx`): the inbox across every Host (a card per waiting session, approvals answered inline, questions shown; "Also waiting on you" with Retry, Take back, Continue; "Approved on <device>" for a minute when another Client answered first, from `ApprovalResolved.resolvedBy`), the hover card on waiting rows and chips, and a summary published to main (`needsYou.publish`). Main shows a notification per new request (one per session, never repeated, none for the session the focused window shows; Approve / Deny buttons on a single approval, a reply field on a question; click opens the session), the menu bar star with the count, and the Dock badge. Answers from notifications and the star come back as `needs-you` app events and are dispatched by the renderer, so every answer from this device takes one path. `POLARIS_DESKTOP_HIDDEN=1` plans notifications without showing them. `#needs-you/inbox` and `#needs-you/hover` render fixtures for screenshots. The smoke test checks the menu bar count, answers the first approval from the inbox and waits for it to leave the summary.

**Session view** (`src/renderer/features/session/`, wired into `SessionIntent`, `SessionOutput` and `NewSession`): the header, the virtualized conversation (Turns streaming live, inline approvals and questions) and the composer (send, steer, stop, attachments, Model) in Intent; the chosen Turn's diff in Output (Changes); the new-session page, whose Harness choice comes from the catalogue and the Host's `harness.availability`. `index.ts` is its interface; pure view models under `model/` are tested. `#preview/<scene>` renders the shell on fixtures (a lazy chunk) for `scripts/sessionScreens.ts`. The smoke test reads its `data-testid`s (`session-state`, `live-item`, `turn-item`, `approval`, `diff-file`, `turn-summary`, `composer-input`, `where-line`, `new-session`).

**Empty states** (`src/renderer/features/empty/`, DESIGN.md's three tiers): `HostStage` (a Host with no Workspaces; the path is typed, `~` expanded with the Host's home, then `RegisterWorkspace`), `WorkspaceStage` (the `NoSession` slot: a stage when the Workspace has no sessions, a pane when none is open) and the `LaterMode` pane. Copy lives in `model.ts`, tested.

**Terminal** (`src/renderer/features/terminal/`): `TerminalDock` wraps a pane (Columns wraps Output and `NoSession`) with the Workspace's drawer; ⌃` toggles it. Tabs persist per Workspace in `localStorage` (`store.ts`), so a relaunch reattaches to the same Daemon terminals with their scrollback. `runtime.ts` (xterm.js, WebGL, a lazy chunk) keeps up to four hidden instances, serializes input so keystrokes reach the PTY in order, debounces resizes, and reattaches feeds when the Host reconnects. Other features call `runInTerminal(place, { key, title, cwd, argv })` (e.g. a Harness sign-in) or `toggleTerminal`; `HarnessTerminal` (`{ hostKey, argv, onExit, onClose }`) is an inline terminal for pages, matching B7's `HarnessTerminal` slot (Settings → Harnesses sign-in). "Open in terminal" (`handoff.ts`): `OpenInTerminal`, poll `session.terminalCommand`, run it (its `env` goes through `env(1)`, since `terminal.open` takes none); `InTerminalBar` and `OpenInTerminalItem` are mounted by the session view. `window.__polarisTerminal.text(id)` exposes a terminal's buffer to the smoke test.

**Attachments** (`src/renderer/features/attachments/`): `useUploads` stages pasted or dropped files (`attachments.stage`) and keeps image thumbnails; `AttachmentDrop` wraps the composer (paste, drop, the drag hint, ⌥ to copy) and `AttachmentTray` renders the chips. ⌥-drop copies into the session's cwd by running `cp` on the Host through `terminal.open` (no file write in M1) and toasts the outcome. `AttachmentsPage` is Settings → Attachments: per Host, `attachments.settings` / `setSettings` / `clear` (capability `attachments.settings`) for the cleanup default, per-Workspace overrides, what is staged, and "Clear now" (`useCleanup.ts`; choices and edits in `cleanup.ts`, tested).

## The bridge

- **Requests**: `window.polaris.request(method, input)` → `Result` (`{ ok, value }` or `{ ok: false, error: { code, message } }`). Methods: settings, `dispatch` (a Client-generated `commandId`; a refusal's message is the Daemon's reason), files, git, `harness.models`, `harness.availability`, `session.terminalCommand`, `usage.query` (buckets with main's API-price estimates), `shell.openExternal` (https only), terminal, `attachments.stage` (bytes → `withBlob` → stage on one connection), `install.ensure`, the snapshot cache, onboarding's `onboarding.found` (the `~/.ssh/config` aliases, `src/main/sshHosts.ts`, and the app version) and `onboarding.welcomeSeen`, `dialog.pickFolder` (the native folder picker), and dev's `dev.proofWorkspace`.
- **Feeds**: `window.polaris.subscribe(kind, input, { items, end })`, including `harness.availability`, `plan-limits` and `usage` (all of `usage.watch`). `host` and `session` are the client's resumable feeds, so every window shares one upstream subscription per stream: Snapshot (cached) first, then events, `Delta`s and `ItemProgress` (the app announces `session.live-items`). Feeds bound to one connection (`terminal`, `files.watch`, `usage`) end when it drops; resubscribe.
- **Batching**: main coalesces every feed's items for a window into one message per 4 ms; the renderer applies them once per animation frame (or every 100 ms while hidden).
- Payloads are structured-clone plain data: class instances lose their prototype, so the renderer types domain values as plain records (`store/plain.ts`).

## Settings

`<userData>/settings.json`: `theme` (`system` | `dark` | `light`), `density` (`calm` | `balanced` | `compact`), `textSize` (`small` | `default` | `large` | `larger`), `diffPalette` (`default` | `cvd`), `motion` (`system` | `reduce` | `full`), `codeFont` (`sf-mono` | `menlo`), `sessionDefaults` (by Harness kind: `{ model, effort, permissionMode }`, what new sessions and the Harness picker start with), `welcomeSeen` (scripts that launch the app past the welcome use `scripts/lib/userData.ts`), `hosts`: `[{ alias, label?, colour?, forwardAgent?, remoteCommand? }]` by `~/.ssh/config` alias (edited from Settings → Hosts), and `local: { enabled }` (this Mac as a Host; on by default). `<userData>/approvals.json` holds the approved Daemon builds per alias. The renderer sets `data-theme` (unset for system), `data-density`, `data-text-size`, `data-diff-palette`, `data-reduce-motion` (unset follows macOS; `false` keeps motion) and `--font-mono` on the root. `settings.setAppearance` takes any subset; every window hears the change as an `AppEvent`.

Environment: `POLARIS_DESKTOP_EXTRA_HOSTS` (screenshots and tests: `[{ key, label, socket }]`, more Hosts on local sockets), `POLARIS_DESKTOP_LOCAL_LABEL`, `POLARIS_DESKTOP_USER_DATA`, `POLARIS_DESKTOP_HIDDEN=1`, `POLARIS_DESKTOP_LOCAL_SOCKET` (+ `POLARIS_DESKTOP_BENCH_HARNESS=1`), `POLARIS_DESKTOP_DAEMON=system|dev`, `POLARIS_DESKTOP_DAEMON_DIST` (the Daemon builds to upload), `POLARIS_DESKTOP_SSH_HOME` (whose `~/.ssh/config` lists aliases; tests).

## Test from another machine

The Desktop App on your laptop, driving a Mac Studio (or a Linux VM, or a Pi) over SSH.

**Prerequisites**

- The Studio: Remote Login on (System Settings → General → Sharing), and your laptop's key in its `~/.ssh/authorized_keys` (`ssh-copy-id studio`). Polaris never answers a password or 2FA prompt.
- The laptop: a `Host studio` block in `~/.ssh/config` (HostName, User, and IdentityFile or an agent key). Polaris only ever uses the alias. Run `ssh studio true` once to trust its host key (or use "Open in Terminal" on the host-key-unknown card, which runs it in the app).
- Daemon builds: a packaged app carries them. In dev (`bun run --cwd apps/desktop dev`), the app builds the Studio's platform from source the first time (`bun scripts/build-daemon.ts darwin-arm64`, needs this repo, Bun and, for darwin, `codesign`), or prebuild all with `bun run --cwd apps/daemon build`.
- A Harness on the Studio (Claude Code or Codex), installed and signed in there. Polaris never installs one; Settings → Hosts links its setup docs and runs its own sign-in in a terminal on the Studio.

**What to expect**

1. Settings → Hosts → **Add a host**: pick `studio`, name it "Mac Studio", leave agent forwarding off. The row appears and says it's checking.
2. No Daemon there yet: the row expands to the approval card with the platform, version, full SHA-256 and `~/.polaris on studio`. **Approve and install** copies the build over SSH, checks its SHA-256 on the Studio and runs `polaris install` (a LaunchAgent; over SSH with nobody logged in at the console it runs in the user domain, and the row's note says so). Nothing is downloaded on the Studio, and nothing needs sudo.
3. The row turns Connected with the Daemon's version; the Studio's Workspaces appear in the machine bar. Later upgrades install on their own and say so under the row; a reconnect never installs.
4. If something needs you, the row says what inline, with ssh's own line and at most one fix: host key unknown (Open in Terminal) or changed (copy `ssh-keygen -R studio`, never a one-click fix), key refused, daemon not running (Start daemon), older daemon (Upgrade).

The remote command defaults to `~/.polaris/bin/current/polaris bridge` (not on PATH in a non-interactive shell); a row's details can override it.

## Known gaps

- Install progress is per step (checking, copying and checking the SHA-256), not per byte; the client reports no byte progress.
- "Open in Terminal" for a host key falls back to macOS Terminal (a `.command` file) while this Mac's local Host is off; otherwise it and Harness sign-in run in the in-app terminal.
- Cost estimates (ENG-207) aren't in yet: Usage shows reported costs and marks the rest unpriced.
- The macOS window closes the app (no dock-only mode yet); no vibrancy.
- The production CSP allows `style-src 'unsafe-inline'` (Radix and sonner inject `<style>` elements); accepted for now, scripts stay `'self'` only.
- The dev server is `http://127.0.0.1:5198` (strict): the `@polaris/ui` gallery holds 5199.
- Navigation persists in `localStorage`, shared by every window of the app; per-window keys come with multiple windows.
- The session view's diff is a lightweight unified renderer (no syntax or word highlights, long lines truncate); Pierre Diffs arrives with Review. Diffs over 4 MB aren't parsed here.
- The conversation shows a session's last 20 Turns (the feed's `turnLimit`); older ones aren't paged in yet. Assistant text is plain (no Markdown yet).
- Session rows are still `role="button"` divs; `@polaris/ui`'s `Row` takes `asChild` now, so they can become buttons.
- Retry on a Failed session opens it (the conversation holds the prompt); there is no Retry command yet.
- The sidebar header keeps the Workspace's name in the Needs you view (Paper 1G2-0 shows "Inbox · All machines").
- No Sources chips or per-session age of last activity yet; ages are since the session was created.
- Attachments have no byte-level progress (one IPC call per file), no folder picker for ⌥-drop (it copies into the session's cwd), and no "Open locally" / "Save to Downloads" for remote files yet.
- Adding a workspace takes a typed path (no native folder dialog: remote Hosts need a path anyway).
