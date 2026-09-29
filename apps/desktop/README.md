# @polaris/desktop

The Electron Desktop App (Electron 44, Chromium 152). The main process runs the Client runtime (`@polaris/client`'s HostRegistry on Effect); the renderer is React 19 with the React Compiler, styled by `@polaris/ui`.

```sh
bun run --cwd apps/desktop dev      # Vite dev server + hot reload; main rebuilt and Electron restarted on change
bun run --cwd apps/desktop build    # out/{main,preload,renderer} and an unpacked out/Polaris.app (macOS)
bun run --cwd apps/desktop start    # electron . against the last build
bun run --cwd apps/desktop smoke    # build, then the end-to-end smoke test (Node; Playwright)
bun run bench desktop-idle          # memory and CPU of the built app, settled (packages/bench)
node scripts/sessionScreens.ts --out <dir> [--frames]   # the session view on fixtures (#preview/<scene>), every theme and density
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
| `src/renderer/features/session/` | The session feature: `SessionIntent` (header, virtualized conversation, composer), `SessionOutput` (the Turn's diff), `SessionView` (both, side by side) and `NewSessionPage`; `index.ts` is its interface. Pure view models under `model/` (Turn rows, items, composer intents, Model picker, unified diff, `StartSession`/Fork), tested. |
| `src/renderer/views/` | The shell and the proof screen. |
| `scripts/` | `build.ts`, `dev.ts`, `smoke.ts` and their helpers. |

## The bridge

- **Requests**: `window.polaris.request(method, input)` → `Result` (`{ ok, value }` or `{ ok: false, error: { code, message } }`). Methods: settings, `dispatch` (a Client-generated `commandId`; a refusal's message is the Daemon's reason), files, git, `harness.models`, `session.terminalCommand`, terminal, `attachments.stage` (bytes → `withBlob` → stage on one connection), `install.ensure`, the snapshot cache, and dev's `dev.proofWorkspace`.
- **Feeds**: `window.polaris.subscribe(kind, input, { items, end })`. `host` and `session` are the client's resumable feeds, so every window shares one upstream subscription per stream: Snapshot (cached) first, then events, `Delta`s and `ItemProgress` (the app announces `session.live-items`). Feeds bound to one connection (`terminal`, `files.watch`) end when it drops; resubscribe.
- **Batching**: main coalesces every feed's items for a window into one message per 4 ms; the renderer applies them once per animation frame (or every 100 ms while hidden).
- Payloads are structured-clone plain data: class instances lose their prototype, so the renderer types domain values as plain records (`store/plain.ts`).

## Settings

`<userData>/settings.json`: `theme` (`system` | `dark` | `light`), `density` (`calm` | `balanced` | `compact`), and `hosts`: `[{ alias, label?, colour?, forwardAgent? }]` by `~/.ssh/config` alias. The renderer sets `data-theme` (unset for system) and `data-density` on the root.

Environment: `POLARIS_DESKTOP_USER_DATA`, `POLARIS_DESKTOP_HIDDEN=1`, `POLARIS_DESKTOP_LOCAL_SOCKET` (+ `POLARIS_DESKTOP_BENCH_HARNESS=1`), `POLARIS_DESKTOP_DAEMON=system|dev`.

## Known gaps

- Settings for Hosts have no UI yet; edit the file. The install / upgrade approval flow is exposed (`install.ensure`) but has no UI, and approvals are not stored.
- The macOS window closes the app (no dock-only mode yet); no vibrancy.
- The production CSP allows inline styles (Radix and sonner inject them); scripts stay `'self'` only.
- The session view's diff is a lightweight unified renderer (no syntax or word highlights, long lines truncate); Pierre Diffs arrives with Review. Diffs over 4 MB aren't parsed here.
- The conversation shows a session's last 20 Turns (the feed's `turnLimit`); older ones aren't paged in yet. Assistant text is plain (no Markdown yet).
- `@polaris/ui`'s `Row` can't be used with `asChild` (its Slot gets several children), so session rows are `role="button"` divs.
