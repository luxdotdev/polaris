# Viability of a Bun + web-tech stack for Polaris

Research for [ENG-183](https://linear.app/luxdev/issue/ENG-183) (map: [ENG-167](https://linear.app/luxdev/issue/ENG-167)). Researched 2026-09-27.

- **Question:** Could Polaris use a Bun Daemon on each Host plus a web-tech Desktop App on macOS, reusing Pierre's Diffs and Trees, instead of native GPUI? What does that cost in snappiness?
- **Sources:** primary sources only (official docs, source code, maintainers' issues and PRs, vendors' own posts). Source trees read at pinned commits:
  - `pierrecomputer/pierre` @ [`cc4963a`](https://github.com/pierrecomputer/pierre/tree/cc4963a85bad91396c48092751473235ddfc0dc7) (2026-09-25)
  - `pingdotgg/t3code` @ [`de251fc`](https://github.com/pingdotgg/t3code/tree/de251fc2971a884cb5b1305ba4daf309dc8cccb0) (2026-09-27)
- **Local measurements** were taken on this machine: Apple M2 Max, 32 GB, macOS, Bun 1.3.13, Node 24.18. They are labelled **[measured]**. Treat them as indicative. They are not a benchmark suite.
- **Prior research not repeated here:** `t3-code.md` (T3 Code architecture), `gpui-ecosystem.md` and `zed-gpui-reuse.md` (the GPUI side), `harness-surfaces.md`, `codex-app-server.md`.

## TL;DR

1. **Pierre Diffs and Trees are a strong, real asset.** Diffs is `@pierre/diffs` 1.5.1 and Trees is `@pierre/trees` 1.0.0-beta.6. Both are Apache-2.0 and framework-agnostic: vanilla JS core, optional React wrappers, plus web components. Both virtualize by line or row. Diffs highlights with Shiki in an optional worker pool. Pierre engineered them against the Linux v6→v7 diff (over 700 MB of patch) and an AOSP tree with 1.59 M files. **[measured]** On that tree, Trees' model computes the visible window in about 0.1–0.2 ms. T3 Code already ships both libraries.
2. **The biggest finding is the renderer: WebKit is measurably worse for this workload.** Pierre's own write-up lists three Safari/WebKit problems: sticky compositing "significantly worse than Chrome or Firefox", `requestAnimationFrame` capped at 60 Hz even on 120 Hz displays, and a WebKit layout bug they had to work around. WKWebView is the renderer for Tauri and for Electrobun's default. **So on macOS, the choice is Electron (Chromium). Tauri and Electrobun are the wrong trade for Polaris.**
3. **T3 Code's shell is Electron 44** with electron-builder and electron-updater. It runs its server through Electron's own binary (`ELECTRON_RUN_AS_NODE=1`) and uses Chromium `<webview>` for its in-app browser preview. Its file editor is Pierre Diffs' edit mode. Its terminal is libghostty-vt compiled to WASM and drawn on a 2D canvas.
4. **Bun is a viable Daemon runtime, but not a free one.** `bun build --compile` cross-targets all three Hosts: **[measured]** 63 MB for darwin-arm64 and about 101 MB for each Linux target. An idle Bun HTTP+SQLite process uses about 27 MB RSS, against about 59 MB for Node. The Claude Agent SDK officially supports Bun, including inside `--compile` binaries, and Claude Code's own native binary is Bun-compiled. `bun:sqlite` works. The Codex app-server is a separate Rust process, so the runtime doesn't matter for it.
5. **Bun's sharp edges hit exactly the Daemon's jobs.** **node-pty does not work under Bun**: no output ever arrives (Bun issues #25822 and #41414; **[measured]** it hung here). Use Bun's native `Bun.Terminal` / `spawn({terminal})` instead, which works here **[measured]**. On the **Raspberry Pi 4, Bun 1.3.7–1.3.8 crashed with SIGILL** because of LSE atomics. That was fixed in 1.3.9, and QEMU baseline-CPU CI was added. Pin the version and test on the Pi.
6. **T3 Code, the closest precedent, removed Bun from its server in September 2026.** It now ships the server as a Node single-executable (about 160 MB) and "is never run under Bun" (PR #11316). The trigger was install-time dependency breakage, not Bun itself. Still, the precedent is "TS Daemon: yes; Bun specifically: optional".
7. **For the Editor, use CodeMirror 6.** It has an official MIT `@codemirror/lsp-client`, first-class block widgets between lines (for inline chat and review), handles multi-million-line documents, and is small. Monaco (with TypeFox's `monaco-languageclient`) is heavier (101 MB unpacked) and harder to trim, although its view zones do the same job. Use Pierre Diffs, not an editor, for diff and review surfaces.
8. **Snappiness gap: web can reach "fast enough" but not GPUI's ceiling.** VS Code's own measurements show DOM rendering blowing the 16 ms frame budget when scrolling on an M2 Pro. The team is moving the editor to a WebGPU renderer to fix that. Zed reports frame times under 4 ms against an 8.33 ms budget at 120 Hz. The working techniques are known (virtualization, Shiki and parsing in workers, React Compiler, canvas or GPU for terminals, local-first data), and T3 Code and Pierre use all of them. The costs don't go away: memory (Pierre's Linux diff still needs about 1.15 GB), GC pauses and startup.
9. **Recommendation:** the Bun/web stack is **viable, with a clear shape**: Electron + React + Pierre Diffs/Trees + CodeMirror 6 on the Mac, and a TypeScript Daemon compiled with Bun on each Host (PTYs via `Bun.Terminal`, `bun:sqlite`). Keep "Node SEA" as a drop-in fallback runtime by writing to portable APIs behind thin adapters, as T3 did. Choose it if Agent SDK parity, T3 reuse and a shared React Native client matter more than a 120 Hz, sub-10 ms UI. See the table and the open questions.

---

## 1. Pierre Diffs and Trees

### Packages, licence, maturity

| | Diffs | Trees |
|---|---|---|
| npm | [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) 1.5.1 (latest, 2026-09-25) | [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees) 1.0.0-beta.6 (latest *and* beta tag, 2026-08-22) |
| Licence | Apache-2.0 ([LICENSE.md](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/LICENSE.md)) | Apache-2.0. [NOTICE.md](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/trees/NOTICE.md) credits MIT code derived from `@headless-tree/core` |
| First release | 1.0.0 on 2025-12-12. About 50 stable releases since, roughly weekly (`npm view @pierre/diffs time`) | First publish 2026-03-16. Still pre-1.0 |
| Runtime deps | `shiki` ^3‖^4, `@shikijs/transformers`, `diff` 9, `hast-util-to-html`, `lru_map`, Pierre theme packages | `preact` 11 beta (internal renderer), `preact-render-to-string`, `@pierre/theming` |
| React | Optional peer (`peerDependenciesMeta.react.optional: true`) | Optional peer |
| Entry points | `.`, `/react`, `/ssr`, `/edit`, `/worker` (+ `worker.js`, `worker-portable.js`) | `.` (vanilla), `/react`, `/ssr`, `/web-components` ([README](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/trees/README.md)) |
| Repo | [pierrecomputer/pierre](https://github.com/pierrecomputer/pierre) monorepo, about 6.2k stars, 30 contributors, 77 open issues (GitHub API) | same |

Maturity signals:
- **Diffs is 1.x and stable-tagged.** Its worker pool is marked "experimental and undergoing active development" ([WorkerPool docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/WorkerPool/content.mdx)), and so is edit mode ([Edit docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/Edit/content.mdx)).
- **Trees is still beta.**
- **T3 Code pins `@pierre/diffs` 1.3.0-beta.10 and carries a local patch** to `VirtualizedFile` height caching ([pnpm-workspace.yaml](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/pnpm-workspace.yaml), `patches/@pierre%2Fdiffs@1.3.0-beta.10.patch`). It also pins `@pierre/trees` 1.0.0-beta.4 ([apps/web/package.json L27-28](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/package.json#L27-L28)). Expect to pin and occasionally patch.

### Framework requirements and rendering approach

- **Framework-agnostic by design.** "We currently only have components for vanilla JavaScript and React". The lower-level APIs "purely render strings (the raw HTML)" and the components "render all this out into Shadow DOM and CSS grid layout" ([Diffs overview](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/Overview/content.mdx)). Diffs also has a web-components entry ([`components/web-components.ts`](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/diffs/src/components/web-components.ts)). Trees "renders inside a shadow root" and uses Preact internally ([Trees README](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/trees/README.md)).
  - **Implication for a future React Native app:** none of this renders natively. T3's mobile app wrote a native Swift diff module for that reason (see `t3-code.md`). Shared code would be the model and protocol layer, not these views.
- **Virtualization:**
  - **`CodeView`** is "one large scroll region" with "built-in per-line virtualization that should scale to nearly any file or diff that can fit in memory". It also provides sticky headers, viewer-wide selection, `scrollTo`, annotations and optional per-item edit mode ([CodeView docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/CodeView/content.mdx)).
  - **The lower-level `Virtualizer`** uses estimated heights, overscan and measured-height reconciliation. The docs warn it is "more likely to blank during fast scroll" than `CodeView` ([Virtualization docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/Virtualization/content.mdx)).
- **Shiki and workers.** By default Shiki runs on the main thread. The worker pool moves highlighting off it: "The main thread will still attempt to render plain text synchronously and then apply the syntax highlighting when we get a response from the worker threads" ([WorkerPool docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/WorkerPool/content.mdx)). T3 mounts a pool through `WorkerPoolManager` ([DiffWorkerPoolProvider.tsx L37](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/src/components/DiffWorkerPoolProvider.tsx#L37)).
- **Annotations** give Polaris review comments and inline chat anchored to diff lines: a "flexible annotation framework for injecting comments, annotations", plus an "accept/reject changes UI" ([Diffs README](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/diffs/README.md)).
- **Edit mode** adds "text editing, multiple selections, undo and redo, search and replace, remote carets, markers" on top of the rendered file or diff ([Edit docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/Edit/content.mdx)). T3 Code uses it as its whole file editor (`Editor` from `@pierre/diffs/editor` with `EditProvider`, in [FilePreviewPanel.tsx L16-17](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/src/components/files/FilePreviewPanel.tsx#L16-L17)). It is not an LSP editor.

### Performance: documented and measured

- **Diffs, documented** in Pierre's post ["On rendering diffs"](https://pierre.computer/writing/on-rendering-diffs) (2026-05-29):
  - Test cases were Bun's Zig→Rust PR, a Node V8 bump, and the Linux v6→v7 diff, "more than 700 MB of patch content".
  - On the Linux diff, memory dropped "from 2.4 GB to around 1.15 GB" and parse time fell by about 80%.
  - Techniques: an "inverse sticky" virtualization (the rendered region "sticks to one edge instead of scrolling away and exposing blank space" when JS falls behind), a line-position checkpoint cache with binary search, custom scroll anchoring, DOM element pooling, Shiki highlighting deferred to workers, and an LRU cache of highlighted results.
  - Stated limit: no horizontal virtualization for very long lines, such as minified code.
- **Diffs, known open issues:**
  - [#760](https://github.com/pierrecomputer/pierre/issues/760): OOMs on "ginormous diffs"; byte-arena parsing proposed.
  - [#1113](https://github.com/pierrecomputer/pierre/issues/1113): a stack overflow on 700k-line single-hunk diffs, now fixed. The engine argument limits were V8 at about 124k and JSC at about 639k.
  - [#1144](https://github.com/pierrecomputer/pierre/issues/1144): collapsing an editable `CodeView` item re-tokenizes synchronously, "60 to 120 ms of main-thread work".
  - **Budget:** very large diffs are fine to scroll, but memory is roughly the size of the patch.
- **Diffs, benchmarking practice.** Pierre's CSS benchmark runbook records Chrome traces while a scripted driver scrolls a large diff ([CSS_PERFORMANCE_BENCHMARK.md](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/diffs/benchmarks/CSS_PERFORMANCE_BENCHMARK.md)). **Chromium is their primary perf target.**
- **Trees, documented.** "Trees already virtualizes the visible row window." For large trees, prepare or presort the input, ideally on the server ([HandleLargeTreesEfficiently](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(trees)/docs/Guides/HandleLargeTreesEfficiently/content.mdx)). Its benchmark fixtures are the Linux tree (464,570 files) and AOSP (1,592,568 files; [benchmark.ts](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/trees/scripts/benchmark.ts)).
- **Trees, [measured].** I ran `bun scripts/benchmark.ts --preset all` at `cc4963a` on this M2 Max. This measures the headless model and layout only: no DOM paint.

  | Scenario (AOSP, 1.59 M files, 1.83 M rows fully expanded) | p50 | p95 |
  |---|---|---|
  | visible window rows (`get-visible-rows-window`) | 0.10 ms | 0.29 ms |
  | view update + window rows while sticky-scrolling | 0.17 ms | 0.29 ms |
  | 8-step scroll sequence + window rows | 0.90 ms | 1.03 ms |
  | toggle one directory (`controller-toggle`) | 0.14 ms | 4.5 ms |
  | rebuild full expansion projection index | 754 ms | 1.03 s |
  | materialize *all* visible rows (anti-pattern) | 555 ms | 616 ms |
  | `getItem` lookups, Linux tree (464k files) | 1.6 ms | 2.6 ms |

  Preparing the AOSP input took 0.6–2.5 s. Do this once, on the Daemon (the docs recommend server-side prepare). Reading the numbers: per-frame tree work is far under budget even for AOSP. Whole-tree operations cost about a second, so they belong off the interaction path.

## 2. Desktop shell on macOS: Electron vs Tauri vs Electrobun

| | Electron | Tauri 2 | Electrobun 2 |
|---|---|---|---|
| Renderer on macOS | Bundled Chromium | System **WKWebView**, versioned with macOS; "updates only through OS updates" ([webview versions](https://v2.tauri.app/reference/webview-versions/)) | System **WKWebView** by default. "CEF is an optional pinned Chromium renderer" ([what is Electrobun](https://framework.blackboard.sh/electrobun/guides/what-is-electrobun/)) |
| Main process | Node (in the Electron binary) | Rust. Other languages run as sidecars (`externalBin` with target-triple suffix) ([sidecar](https://v2.tauri.app/develop/sidecar/)) | Now **Cottontail** by default ("built with Zig on JavaScriptCore … Node.js and Bun-compatible APIs"); Bun optional ([README](https://github.com/blackboardsh/electrobun)) |
| Size | Ships Chromium (tens of MB up) | "a minimal Tauri app can be less than 600KB" ([start](https://v2.tauri.app/start/)) | "megabytes, not hundreds of them" without CEF |
| Clipboard image | Native `clipboard.readImage()`, plus the web `paste` event | `clipboard-manager` plugin has `read_image`/`write_image` on macOS, Linux and Windows ([clipboard](https://v2.tauri.app/plugin/clipboard/)) | Web `paste` event in the webview |
| Auto-update | `autoUpdater` / electron-updater (T3 uses [`electron-updater`](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/desktop/package.json#L29)) | updater plugin | "Verified updates served from static storage, with transactional replacement and rollback" ([docs home](https://framework.blackboard.sh/electrobun/)) |
| Maturity | Electron 44.4.x (`npm view electron`). Runs VS Code, Cursor, Linear, T3 Code | 2.x (`@tauri-apps/cli` 2.12.0) | v2.0.2-beta.33 on 2026-09-27, still betas. About 12.9k stars. The maintainer writes "there should be no expectation that I will review, respond to, or merge" issues or PRs ([README](https://github.com/blackboardsh/electrobun)) |

**Why WKWebView matters for Polaris specifically:**
- Pierre, the authors of the libraries Polaris would reuse, list the Safari/WebKit problems they hit while building virtualized diffs ([On rendering diffs](https://pierre.computer/writing/on-rendering-diffs)):
  - "Sticky compositing performance that appears significantly worse than Chrome or Firefox"
  - "`requestAnimationFrame` still being capped at 60Hz, even on higher refresh-rate displays"
  - dev tools that make cross-layer perf tracing hard
  - a deep scroll/layout bug ([WebKit 308027](https://bugs.webkit.org/show_bug.cgi?id=308027)), worked around in [`guardWebKitScrollDuringRebuild.ts`](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/packages/diffs/src/utils/guardWebKitScrollDuringRebuild.ts)
  - Their summary: "Safari still found a way to break our hearts."
- The 60 Hz cap is deliberate WebKit policy. WebKit's [animation-frame-rate explainer](https://github.com/WebKit/explainers/tree/main/animation-frame-rate) and [bug 173434](https://bugs.webkit.org/show_bug.cgi?id=173434) cover the rationale: power use, and pages that break at non-60 Hz. The only way to lift it in an embedded WKWebView is a private WebKit feature flag (`PreferPageRenderingUpdatesNear60FPSEnabled`).
- **For Polaris:** on a 120 Hz display, a WKWebView shell starts at half GPUI's frame rate. The WebKit version also moves with macOS, not with the app. Chromium is also what Pierre benchmarks against. **Electron is the right shell if the UI is web.**
  - Tauri's advantages (tiny bundle, Rust main process) don't help Polaris much. The heavy logic lives in the Daemon anyway.
  - Electrobun's two selling points are Bun and small size. Its default runtime is no longer Bun, and "small" only holds with WKWebView.

**How T3 Code does it (Electron 44):**
- **Build and update:** electron-builder and electron-updater ([apps/desktop/package.json](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/desktop/package.json)). Updater, menu, protocol and window wrappers live in `src/electron/` (`ElectronUpdater.ts`, `ElectronMenu.ts`, `ElectronProtocol.ts`).
- **Local server:** spawned from the Electron binary itself: `executablePath: process.execPath` plus `ELECTRON_RUN_AS_NODE: "1"` ([DesktopBackendConfiguration.ts L571-586](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L571-L586)). No second runtime ships.
- **In-app browser preview:** "Hosts per-tab Chromium WebContents references (the actual `<webview>`…)" ([preview/Manager.ts L4](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/desktop/src/preview/Manager.ts#L4)). This feature is Chromium-specific.
- **Terminal:** libghostty-vt compiled to WASM and drawn with `canvas.getContext("2d", { alpha: false })` ([surface.ts L707](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/src/terminal/ghostty/surface.ts#L707), [build-libghostty-wasm.sh](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/scripts/build-libghostty-wasm.sh)).

**Startup and memory:** I found no first-party startup or RSS numbers for any of the three shells. Electron's [performance checklist](https://www.electronjs.org/docs/latest/tutorial/performance) is qualitative: don't load modules carelessly, defer work, never block the main process ("your entire app will freeze"), use workers in the renderer, bundle your code, and call `Menu.setApplicationMenu(null)` if no default menu is needed. **Measure a Polaris shell prototype before committing.** See the open questions.

## 3. Bun as the Daemon runtime

**Cross-compiling.**
- `bun build --compile --target=` supports `bun-darwin-arm64`, `bun-linux-x64` and `bun-linux-arm64`, plus musl and Windows variants. On x64, one binary targets Nehalem and picks AVX2/AVX-512 paths at runtime ([executables docs](https://bun.com/docs/bundler/executables)).
- Bun's own docs admit "Bun's binary is still way too big". macOS signing needs JIT entitlements. `.node` addons can be embedded.
- **[measured]** A trivial `bun:sqlite` program compiled with Bun 1.3.13 to **63 MB** (darwin-arm64), **102 MB** (linux-x64) and **101 MB** (linux-arm64, ELF aarch64). On this machine the unsigned darwin binaries were SIGKILLed at launch (exit 137), and ad-hoc re-signing failed "strict validation". That fits the docs' signing guidance, but I couldn't separate it from local sandboxing. Budget for signing and notarizing the Mac Daemon.
- For comparison, T3's Node 26 single-executable is about 160 MB ([PR #11316](https://github.com/pingdotgg/t3code/pull/11316)).

**Memory for the Pi 4.**
- **[measured]** An idle `Bun.serve` + `bun:sqlite` process sat at **26.6 MB RSS**, against **59 MB** for the equivalent Node 24 (`node:http` + `node:sqlite`), across 3 runs each.
- The Daemon's own footprint is not the Pi's constraint. Harness processes are: every Claude session is a `claude` process (see below), and every Codex session is a `codex app-server` process.

**Raspberry Pi 4 compatibility (Cortex-A72, ARMv8.0).**
- Bun 1.3.7 and 1.3.8 crashed with "Illegal instruction" on ARMv8.0 CPUs, because of inline LSE atomics in WebKit/libpas and mimalloc ([#26556](https://github.com/oven-sh/bun/issues/26556)).
- Fixed in [Bun 1.3.9](https://bun.com/blog/bun-v1.3.9): "Bun now correctly targets ARMv8.0 on Linux aarch64". A WebKit rebuild with `-march=armv8-a+crc` added QEMU baseline-CPU verification in CI ([PR #26583](https://github.com/oven-sh/bun/pull/26583)).
- **Treat the Pi as a tier-1 CI target and pin the Bun version.**

**Claude Agent SDK under Bun: first-class.**
- The TS SDK's `executable` option is `'bun' | 'deno' | 'node'`.
- For `bun build --compile`, the docs give an `extractFromBunfs()` recipe that embeds the per-platform `claude` binary (SDK ≥ 0.3.144; [SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)).
- The SDK ships per-platform optional deps, including `linux-arm64` and musl variants (`npm view @anthropic-ai/claude-agent-sdk optionalDependencies`).
- **[measured]** The bundled `claude` for darwin-arm64 is a **225 MB Bun-compiled executable** (its strings identify "Bun v1.4.3"). Anthropic's own agent already runs on Bun. Embedding it would roughly triple the Daemon binary, so pointing `pathToClaudeCodeExecutable` at the user's installed `claude`, as T3 does, is the better default.
- **Licence caveat** (from `t3-code.md`): the SDK is not OSS.

**Codex app-server: runtime-independent.** It is a separate Rust process speaking JSON-RPC over stdio (or WebSocket; [codex-rs/app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server)). Any runtime that can spawn a process and read lines works.

**PTY.**
- **node-pty is broken under Bun.** Bun's `tty.ReadStream` treats `EAGAIN` on node-pty's non-blocking master fd as fatal, so "every `node-pty` consumer under Bun … receives zero terminal output" ([#41414](https://github.com/oven-sh/bun/issues/41414), duplicate of [#25822](https://github.com/oven-sh/bun/issues/25822); fix PR #41495 linked). **[measured]** node-pty 1.2.0-beta.15 under Bun 1.3.13 produced no output and never fired `onExit` in 2 minutes. The same script under Node printed `"99\r\nTTY\r\n"` and exited 0.
- **Bun has a native PTY:** `Bun.spawn(cmd, { terminal: { cols, rows, data } })` and the `Bun.Terminal` class, POSIX only ([Terminal reference](https://bun.com/reference/bun/Terminal), [PR #25415](https://github.com/oven-sh/bun/pull/25415)). **[measured]** A child saw `tput cols` = 123 and `test -t 1` true.
- T3 used exactly this split while it still supported Bun: `BunPtyAdapter` on Bun, `NodePtyAdapter` on Node ([PR #3394](https://github.com/pingdotgg/t3code/pull/3394) structured "unavailable Bun PTY operations" when the terminal handle or `resize` was missing).
- [`bun-pty`](https://github.com/sursaone/bun-pty) (MIT, 0.4.10) is a third-party alternative.

**SQLite.** `bun:sqlite` is built in and worked in both the compiled and the `bun run` tests above. T3 had a `bun:sqlite` path and now uses `node:sqlite` ([#11316](https://github.com/pingdotgg/t3code/pull/11316)).

**Precedent: T3 Code left Bun.**
- As of July 2026 the T3 desktop app ran a Bun-hosted server. Users reported "force-quitting the Bun process" to recover from startup hangs, root cause unclear ([#5045](https://github.com/pingdotgg/t3code/issues/5045)).
- A Bun-hosted server also loaded two copies of `effect`, which silently dropped CORS headers ([#9118](https://github.com/pingdotgg/t3code/pull/9118)).
- In September, [PR #11316](https://github.com/pingdotgg/t3code/pull/11316) made the CLI a Node single-executable to stop install-time failures ([#11208](https://github.com/pingdotgg/t3code/issues/11208) npm ERESOLVE loops, [#6012](https://github.com/pingdotgg/t3code/issues/6012) node-pty compiling on Linux). Then: "Since the server now ships as a Node single-executable and is never run under Bun, this layer also drops every Bun-specific path: `BunPtyAdapter`, … the `bun:sqlite` client selection …".
- **The lesson for Polaris:** ship a single self-contained binary per Host, never `npm install` on the Host. Bun's `--compile` gives you that natively.

## 4. Web editor: CodeMirror 6 vs Monaco

| | CodeMirror 6 | Monaco |
|---|---|---|
| LSP | Official **`@codemirror/lsp-client`** 6.3.0 (MIT, by Marijn Haverbeke). It talks to a server through a minimal `Transport` (`send`/`subscribe`/`unsubscribe`), so a WebSocket to the Daemon's LSP proxy is a few lines ([README](https://github.com/codemirror/lsp-client)) | None built in. Use TypeFox's **`monaco-languageclient`** 11.0.2 (MIT; [repo](https://github.com/TypeFox/monaco-languageclient)), which wraps VS Code's client stack |
| Widgets between lines (inline chat, review comments) | `Decoration.widget({ block: true })` "will be drawn between lines". Block decorations must come from state, not view plugins ("Block decorations may not be specified via plugins"). Call `requestMeasure` when height changes (`@codemirror/view` 6.43.13 `index.d.ts`) | View zones: `IViewZone { afterLineNumber, … }` via `changeViewZones` (monaco-editor 0.57.0 `editor.api.d.ts`). This is how VS Code does inline chat and peek |
| Large files | Viewport-only rendering. The [huge-document example](https://codemirror.net/examples/million/) loads "a few million lines". The parser deliberately stops highlighting far from the viewport to save battery and memory | VS Code's piece-tree buffer. Mature at large files, but the package is 101 MB unpacked (`npm view monaco-editor dist.unpackedSize`) vs 1.3 MB for `@codemirror/view` |
| Modularity | Minimal and modular. Sourcegraph replaced 90% of its Monaco usage in two days after Monaco hit "40% of their external dependencies" ([Sourcegraph](https://sourcegraph.com/blog/migrating-monaco-codemirror)) | Batteries included. Hard to trim (same source) |

**Recommendation.**
- **Use CodeMirror 6 for the Editor.** It has an official LSP client, block widgets fit line-targeted inline chat, and the bundle is small.
- **Use Pierre Diffs' `CodeView` and annotations for review and diff.** Don't build diff review inside the editor.
- **Pierre edit mode** (T3's choice) is attractive for "fix a line while reviewing", but it has no LSP and is experimental.

## 5. How close can web get to native snappiness?

**Evidence of the gap.**
- **VS Code's own numbers.** DOM rendering is VS Code's bottleneck. Investigating "zero latency typing" found "the biggest win would be doing rendering manually using our own shaders". On an M2 Pro, scroll-to-top frames on main exceeded 16 ms, while the WebGPU prototype stayed under 16 ms. On a Windows gaming PC it went from about 20 ms to under 10 ms ([vscode#221145](https://github.com/microsoft/vscode/issues/221145)). The renderer shipped as experimental `editor.experimentalGpuAcceleration` in [1.96](https://code.visualstudio.com/updates/v1_96).
- **Zed's numbers.** Zed reports "frame times under 4ms" against a 120 Hz budget of about 8.33 ms, after Metal pipeline work: triple buffering, and `CADisplayLink` keeping ProMotion at 120 Hz for 1 s after input ([Zed 120fps](https://zed.dev/blog/120fps)). Its comparison page claims "sub-10ms typing latency" and says VS Code "can exceed 50ms under load" and uses "3-4GB+ RAM", but **gives no methodology** ([zed.dev/compare/vscode](https://zed.dev/compare/vscode)). Treat that page as marketing.
- **The WebKit cap.** In WKWebView shells the ceiling is 60 Hz rAF (§2). Pierre's diff pipeline still needs about 1.15 GB for the Linux diff ([On rendering diffs](https://pierre.computer/writing/on-rendering-diffs)).

**Techniques that work, with evidence of use.**

| Technique | Where it's used |
|---|---|
| Virtualize everything | Pierre `CodeView` and Trees; T3 uses `@legendapp/list` for chat and pickers ([apps/web/package.json L25](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/package.json#L25)) |
| Keep parsing and highlighting off the main thread | Pierre's Shiki worker pool and LRU; T3's `DiffWorkerPoolProvider` |
| Avoid re-renders | T3 builds with `babel-plugin-react-compiler` ([L76](https://github.com/pingdotgg/t3code/blob/de251fc2971a884cb5b1305ba4daf309dc8cccb0/apps/web/package.json#L76)); Pierre avoids deep-equality models (`version` bumps per item, [CodeView docs](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/CodeView/content.mdx)) |
| Use raw HTML strings, Shadow DOM and CSS containment instead of framework DOM for hot views | [Diffs overview](https://github.com/pierrecomputer/pierre/blob/cc4963a85bad91396c48092751473235ddfc0dc7/apps/docs/app/(diffs)/docs/Overview/content.mdx); Pierre's CSS benchmark runbook |
| Canvas or GPU for dense grids | T3's libghostty-WASM terminal on canvas; VS Code's WebGPU editor |
| Keep the main process free | [Electron perf checklist](https://www.electronjs.org/docs/latest/tutorial/performance) |
| Local data, sync in the background | Linear frames its client around a realtime sync engine ([Scaling the Linear Sync Engine](https://linear.app/now/scaling-the-linear-sync-engine)) |

**Net:** with discipline, a Chromium-based UI can hold 60 fps on huge diffs and trees. Pierre is the proof. It will struggle to match GPUI's consistent sub-8 ms frames at 120 Hz, its baseline memory and its cold start. VS Code, the best-funded web editor, is itself moving hot paths to the GPU.

## GPUI vs Bun/web for Polaris

| Dimension | GPUI (Rust Daemon + GPUI Desktop App) | Bun/web (Bun Daemon + Electron/React Desktop App) |
|---|---|---|
| UI frame rate and latency ceiling | 120 Hz, under 4 ms frames reported by Zed | Chromium: 60 fps achievable with work; 120 Hz not demonstrated for DOM-heavy views. WKWebView: capped at 60 |
| Memory and startup | Native baseline | Electron baseline plus a JS heap. Large diffs cost about the patch size in memory (Pierre) |
| Diff and review view | Build your own; gpui-kit has no diff view (`gpui-ecosystem.md`) | **Pierre Diffs, ready now:** virtualized, annotations, workers, Linux-diff-scale |
| File tree | gpui-kit virtual lists | **Pierre Trees:** AOSP-scale, 0.1–0.2 ms window updates **[measured]** |
| Editor + LSP | gpui-kit editor has LSP traits but no client and no block widgets (`gpui-ecosystem.md`) | CodeMirror 6 + official LSP client + block widgets |
| Terminal | `alacritty_terminal` in-process | libghostty-WASM on canvas (T3), or xterm.js WebGL |
| Harness: Claude | CLI stream-json only; the Agent SDK is TS-only | **Agent SDK native**, including under `bun --compile` |
| Harness: Codex | app-server JSON-RPC (same) | app-server JSON-RPC (same) |
| Daemon on Pi 4 | Static Rust binary, small RSS | Bun: about 100 MB binary, about 27 MB idle RSS **[measured]**; ARMv8.0 regressions have happened (fixed 1.3.9) |
| PTY | `portable-pty` | `Bun.Terminal` (node-pty broken under Bun) |
| Reuse of T3 Code (MIT, TS) | Design only | **Design and code:** protocol schemas, client-runtime, checkpointing, UI components |
| Future React Native app | Separate codebase | Shares TS protocol, client runtime and state. Pierre views don't port; T3 wrote native diff and terminal modules |
| Language count | Rust (+ TS only if the SDK is used via a sidecar) | TS everywhere (+ C/Zig/WASM deps) |
| Licensing | Zed's GPL crates if reused | All Apache/MIT, except the Agent SDK's proprietary terms |
| Upstream risk | GPUI pre-1.0, pinned forks | Pierre Trees beta, Diffs edit/worker experimental; Bun runtime regressions; Electron is stable |

## Recommendation

**The Bun/web stack is viable for Polaris. Choose it if speed of building the IDE surfaces and Harness integration matters more than a native-grade UI ceiling.** If it's chosen:

1. **Desktop App:** Electron (Chromium), not Tauri or Electrobun. The WKWebView 60 Hz cap and WebKit compositing issues directly hit Polaris's heaviest surfaces. Chromium is also Pierre's benchmark target and T3's shell.
2. **UI:**
   - React with the React Compiler.
   - Pierre Diffs `CodeView` + worker pool for diffs and review, using annotations for review comments.
   - Pierre Trees with inputs prepared on the Daemon.
   - CodeMirror 6 + `@codemirror/lsp-client` over the Daemon's WebSocket for the Editor, with block widgets for inline chat.
   - A canvas or WebGL terminal.
3. **Daemon:**
   - TypeScript, compiled per Host with `bun build --compile`: darwin-arm64, linux-x64, linux-arm64.
   - Use `Bun.Terminal` for PTYs, `bun:sqlite`, the Claude Agent SDK pointed at the user's `claude`, and `codex app-server` over stdio.
   - Put runtime-specific bits (PTY, SQLite, HTTP server) behind small adapters so a Node SEA fallback stays possible. T3's experience says keep it.
4. **Performance as a gated requirement:**
   - Set frame and latency budgets early (e.g. 60 fps under scroll on the Linux diff, keystroke-to-paint under 16 ms in the Editor).
   - Add a Chrome-trace benchmark like Pierre's to CI.
   - Put the Pi 4 in CI (QEMU cortex-a72 at minimum, real hardware ideally).

If a sub-8 ms, 120 Hz feel is non-negotiable, stay with GPUI. Consider a hybrid: a TS sidecar in the Daemon only for the Claude Agent SDK.

## Open questions

- **Display refresh rate.** Is the Mac Studio's display 120 Hz? If it's 60 Hz, GPUI's frame-rate headroom matters less in daily use. The WebKit cap would also stop mattering, though the compositing issues remain.
- **Measure the Electron shell.** Before committing, measure a Polaris-shaped Electron prototype on this Mac: cold start, idle RSS, keystroke latency in CodeMirror, and Pierre `CodeView` scrolling the Linux diff. Compare it with a GPUI spike. No first-party numbers exist for these.
- **Pi 4 RAM (2, 4 or 8 GB)** versus N concurrent `claude` (225 MB binary, Bun-based) and `codex app-server` processes. Measure per-session RSS on the Pi.
- **Bun on the actual Pi.** Test `--compile` output on the Pi, plus the `Bun.Terminal` resize and write edge cases T3 hit (#3394).
- **Signing and notarizing** the darwin Daemon binary with JIT entitlements. Local unsigned `--compile` output was killed here.
- **Claude Agent SDK licence** if Polaris is open-sourced and ships the SDK inside the Daemon.
- **React Native reuse.** Pierre's views don't port. Decide early whether mobile needs native diff and terminal modules (T3 did).
- **Pierre API churn.** Trees is beta, and Diffs' worker pool and edit mode are experimental. Pin versions and budget for patches (T3 carries one).
