# @polaris/desktop

The Electron Desktop App (Electron 44, Chromium 152). The main process runs the Client runtime (`@polaris/client`'s HostRegistry on Effect); the renderer is React 19 with the React Compiler, styled by `@polaris/ui`.

```sh
bun run --cwd apps/desktop dev      # Vite dev server + hot reload; main rebuilt and Electron restarted on change
bun run --cwd apps/desktop build    # out/{main,preload,renderer} and an unpacked out/Polaris.app (macOS)
bun run --cwd apps/desktop start    # electron . against the last build
bun run --cwd apps/desktop smoke    # build, then the end-to-end smoke test (Node; Playwright)
bun run bench desktop-idle          # memory and CPU of the built app, settled (packages/bench)
node scripts/screens.ts <dir>       # screenshots against Paper 11U-0 / MX-0, from four seeded local Daemons
```

`dev` connects the local Host to `~/.polaris/daemon.sock` when a Daemon answers there; otherwise it starts a dev Daemon from source with its own home and the scripted bench Harness, and keeps it across restarts (ADR 0007). Builds: Vite for the renderer, `Bun.build` for main and preload (ADR 0008).

## Layout

| Path | What |
|---|---|
| `src/shared/contract.ts` | The IPC contract's inputs as Effect Schemas: every request and subscription, decoded in main before anything runs. The renderer imports it for types only. |
| `src/shared/api.ts` | Outputs, feed items, `AppEvent`, channel names and `PolarisApi` (`window.polaris`). Types and constants only. |
| `src/preload/index.ts` | `contextBridge` exposes `PolarisApi`; one listener demultiplexes every subscription's batches. CommonJS, sandboxed. |
| `src/main/index.ts` | App lifecycle, settings, appearance, window, protocol, IPC; prints `polaris: ready` once painted and the local Host is up. |
| `src/main/hosts.ts` | `HostDirectory`: the Hosts from settings on the HostRegistry, and their `HostView`s (Connection States) for the renderers. |
| `src/main/ipc/` | `requests.ts` (one handler per method; blobs taken here and sent as bytes), `feeds.ts` (host, session, terminal, files.watch, hosts), `subscriptions.ts` (per window), `batcher.ts` (one IPC message per 4 ms window per window), `install.ts` (`install.ensure`). |
| `src/main/localDaemon.ts` | Which socket the local Host uses; the dev Daemon. |
| `src/main/protocol.ts`, `window.ts`, `menu.ts` | `app://polaris` with a strict CSP, the `hiddenInset` window, the native menu (⌘1–3, appearance, density). |
| `src/main/snapshotCache.ts` | The last synchronized Host snapshots, painted at launch and then revalidated (ENG-175). |
| `src/renderer/store/` | Pure reducers for Host and session feeds (`hostModel.ts`, `sessionModel.ts`), a zustand vanilla store applying one frame's updates at a time (`store.ts`, `frameQueue.ts`). |
| `src/renderer/views/` | The shell and the proof screen. |
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

The smoke test reads `data-testid`s from the session placeholder (`live-item`, `turn-items`); a feature replacing `SessionIntent`/`SessionOutput` keeps them or updates `scripts/smoke.ts`.

## The bridge

- **Requests**: `window.polaris.request(method, input)` → `Result` (`{ ok, value }` or `{ ok: false, error: { code, message } }`). Methods: settings, `dispatch` (a Client-generated `commandId`), files, git, `session.terminalCommand`, terminal, `attachments.stage` (bytes → `withBlob` → stage on one connection), `install.ensure`, the snapshot cache, and dev's `dev.proofWorkspace`.
- **Feeds**: `window.polaris.subscribe(kind, input, { items, end })`. `host` and `session` are the client's resumable feeds, so every window shares one upstream subscription per stream: Snapshot (cached) first, then events, `Delta`s and `ItemProgress` (the app announces `session.live-items`). Feeds bound to one connection (`terminal`, `files.watch`) end when it drops; resubscribe.
- **Batching**: main coalesces every feed's items for a window into one message per 4 ms; the renderer applies them once per animation frame (or every 100 ms while hidden).
- Payloads are structured-clone plain data: class instances lose their prototype, so the renderer types domain values as plain records (`store/plain.ts`).

## Settings

`<userData>/settings.json`: `theme` (`system` | `dark` | `light`), `density` (`calm` | `balanced` | `compact`), and `hosts`: `[{ alias, label?, colour?, forwardAgent? }]` by `~/.ssh/config` alias. The renderer sets `data-theme` (unset for system) and `data-density` on the root.

Environment: `POLARIS_DESKTOP_EXTRA_HOSTS` (screenshots and tests: `[{ key, label, socket }]`, more Hosts on local sockets), `POLARIS_DESKTOP_LOCAL_LABEL`, `POLARIS_DESKTOP_USER_DATA`, `POLARIS_DESKTOP_HIDDEN=1`, `POLARIS_DESKTOP_LOCAL_SOCKET` (+ `POLARIS_DESKTOP_BENCH_HARNESS=1`), `POLARIS_DESKTOP_DAEMON=system|dev`.

## Known gaps

- Settings for Hosts have no UI yet; edit the file. The install / upgrade approval flow is exposed (`install.ensure`) but has no UI, and approvals are not stored.
- The macOS window closes the app (no dock-only mode yet); no vibrancy.
- The production CSP allows `style-src 'unsafe-inline'` (Radix and sonner inject `<style>` elements); accepted for now, scripts stay `'self'` only.
- The dev server is `http://127.0.0.1:5198` (strict): the `@polaris/ui` gallery holds 5199.
- Navigation persists in `localStorage`, shared by every window of the app; per-window keys come with multiple windows.
- `@polaris/ui`'s `Row` can't be used with `asChild` (its Slot gets several children), so session rows are `role="button"` divs.
- No Sources chips, "Add machine" or per-session age of last activity yet; ages are since the session was created.
