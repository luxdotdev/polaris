# Spike 2: Electron + Pierre Diffs (ENG-184, throwaway)

This spike builds the screen from the shared `SPEC.md`: a titlebar with a segmented control, a Workspace bar (⌃1…⌃9), an Input column of Agent Sessions, and a virtualized unified Rust diff. It also has a pop-out diff window (View → Pop Out Diff, ⌘⇧O). The stack is Electron 44.4.5 (Chromium 152, V8 15.2), React 19.3 with the React Compiler, `@pierre/diffs` 1.5.1 (CodeView plus a Shiki worker pool) and Vite 8.

## Build and run

```sh
cd prototypes/spike-electron
bun install            # electron is a trusted dependency; if dist/ is missing: node node_modules/electron/install.js
bun run start          # vite build && electron .   (production assets over a custom app:// scheme, no dev server)
bun run bench          # vite build && node scripts/bench.mjs  -> results/electron-<scenario>.json
node scripts/bench.mjs scroll-290k switch   # a subset
node_modules/.bin/electron . --bench <scenario>   # one scenario (build first)
```

- **Fixtures.** The spike reads fixtures from `../../../spike-fixtures`, the scratchpad layout. Override this with `SPIKE_FIXTURES=/path`.
- **Toggles.** These environment variables drive the A/B runs: `SPIKE_POOL_SIZE`, `SPIKE_WORKERS=0`, `SPIKE_POPOUT=separate`, `SPIKE_SHARE_POOL=0`, `SPIKE_TRIM=0`, `SPIKE_JS_FLAGS`, `SPIKE_EXTRA_SWITCHES`, `SPIKE_HIGHLIGHTER=shiki-js`, `SPIKE_AST_CACHE`, `SPIKE_SWITCH_MODE=sidebar` and `SPIKE_BG_THROTTLE=0`.
- **Variant runs.** `SPIKE_VARIANT=name SPIKE_RESULTS=results/variants` writes a variant's results to a separate file. The A/B files are in `results/variants/`.
- **Build time.** `vite build` takes about 0.6 s. There is no build step for the main process: `electron/main.cjs` is plain CommonJS.

## How it is measured

- **Frames.** Frame intervals are the deltas between `requestAnimationFrame` timestamps. The scroll is a steady `scrollTop = 4000 px/s × elapsed`, set inside rAF.
- **Chromium frame attribution.** A `PerformanceObserver('long-animation-frame')` records Long Animation Frames, with script attribution.
- **Blank-frame check.** Every 8th frame, a geometry-based probe samples 5 points of the viewport and classifies each one as blank, plain code or highlighted code. It cannot use hit-testing, because Pierre disables pointer events while scrolling. This makes the frame numbers honest: a smooth frame that shows nothing would be counted as blank.
- **Display.** The main display runs at **180 Hz**. rAF runs at about 182 Hz (median 5.5 ms) with **no flags needed**, so Chromium follows the display's refresh rate on macOS.
- **Workspace switch.** The bench dispatches a real `keydown` ⌃N event on `window`, which is the same handler a keypress hits. The primary number is **input → the second rAF after the React commit**, which estimates when that frame is presented. The JSON also includes input→commit and input→frame-start.
- **Memory.** Memory is `ps -o rss` summed over the Electron process tree (the `ps` and `footprint` processes themselves are excluded). The JSON also has `footprint -p` (phys_footprint, what Activity Monitor shows) and `app.getAppMetrics()` as cross-checks, each process's role, and the system's swap state.
- **Cold start.** The bench runner takes T0 just before `spawn(electron)`. The end point is the presented frame after code lines first appear in the viewport. The runner discards 1 warm-up launch and reports the median of 5 launches. The first launch after a rebuild is about 300 ms slower, because the OS file cache and the V8 code cache are cold.

## Sanity-run numbers (NOISY)

These numbers are noisy. The GPUI spike was building and benchmarking on the same Mac, and the machine was under heavy memory pressure (swap about 11.1 of 12 GB used; free RAM 200–700 MB). **RSS is unreliable under memory pressure.** In one run, macOS compressed or swapped the pages and RSS read 178 MB while footprint read 739 MB. Take the final numbers on an idle machine.

The machine is a Mac Studio M2 Max, and the main display runs at 180 Hz. The results use the default config: a shared renderer, a Shiki worker pool of 1, feature trimming on, and no V8 flags.

| Scenario | Result |
|---|---|
| cold-start | **420 ms** to the first diff frame; 437 ms to highlighted. Of that, about 130 ms is process spawn → main script, about 240 ms is → renderer navigation start, and 20 ms is fetch + parse of the 10k diff. |
| open-diff (median of 3) | 10k **19 ms** · 40k **58 ms** · 290k **223 ms**. For 290k, parsing the patch takes about 190 ms of main thread; highlighting lands in the same frame or the next. The first open of each size is slower (the 290k first open took 417 ms). |
| scroll-10k | 1799 frames in 10 s · p50 5.5 / p95 6.4 / p99 6.9 / max 11.6 ms · **0.06 % > 8.33 ms** · 0 % > 16.7 ms · no LoAFs · viewport samples 0.1 % blank, 6 % plain (not yet highlighted), rest highlighted |
| scroll-40k | p50 5.5 / p95 6.5 / p99 6.9 / max 11.2 · 0.06 % > 8.33 · 0 % > 16.7 · 0.1 % blank |
| scroll-290k | p50 5.5 / p95 6.5 / p99 6.9 / max 12.0 · 0.06 % > 8.33 · 0 % > 16.7 · 0.1 % blank, 7 % plain. Across 20 random jumps: code is on screen in **p50 10.6 / max 11.7 ms** (2 frames); frame intervals during jumps have a max of 11.4 ms. |
| switch (50×, ⌃N) | input → presented frame: **p50 10.6 / p95 16.2 / max 17.2 ms**. Input → commit is under 1 ms. This number swaps both the session list and the diff content; sidebar-only is p50 10 / p95 13.8. |
| memory-idle | **488 MB RSS** (218 MB footprint) in 4 processes: Browser 167, GPU 77, Network 46, Renderer 199 |
| memory-heavy | **928 MB RSS** (729 MB footprint) in 4 processes: Browser 184, GPU 90, Network 46, and **one renderer for both windows** at 608. RSS ranged 928–1020 MB across runs. |

Some caveats:
- A 10 s run at 4000 px/s covers 40k px, so no fixture reaches the end.
- Occasional single 100–200 ms stalls appeared in some early runs and did not reproduce. I attribute them to machine contention.

## Which optimizations mattered (A/B in `results/variants/`)

| Optimization | Effect |
|---|---|
| **Pop-out shares the renderer** (`window.open` same-origin on a privileged `app://` scheme, allowed by `setWindowOpenHandler`, which creates a native child `BrowserWindow`) | **The biggest win.** `popoutSharesRenderer: true`, with 4 processes instead of 5. memory-heavy was about 1015 MB RSS / 800 MB footprint shared, against about 1360 MB / 1050 MB with a separate BrowserWindow. **The pop-out also reuses the opener's Shiki worker pool** through `window.opener.__spikePool`; this works because the windows share a realm-compatible, same-process context. |
| **Shiki in workers** | Needed for jumps. With no workers, steady scroll was still fine (p95 6.5), but content after a random jump took p50 54 ms / max 172 ms, and there were LoAFs. With workers it was p50 about 10 ms / max 12–19 ms. |
| **Worker pool size** | Each worker is a V8 isolate plus the Oniguruma wasm engine, about 70 MB. **One worker was as good as three** for these scenarios: the same plain-code % and the same jump latency, because only one viewport of highlighting is ever in flight. Moving from 3 workers to 1 saved about 90 MB RSS / 100–150 MB footprint in memory-heavy. The default is now 1. |
| **Virtualization** (Pierre CodeView) | Required. Only the visible items are DOM, and steady scroll holds 180 Hz even on the 290k diff. `setItems` for 382 files takes about 2.5 ms. |
| **Avoiding re-renders** | CodeView is vanilla and imperative, mounted once in a `memo` host that never re-renders. React (with the React Compiler, confirmed via `_c()` in the bundle) owns only the chrome. A switch commits in under 1 ms. |
| **V8 flags** | `--max-semi-space-size=2` looked like it saved about 50 MB, but combined with pool 2 it **broke worker highlighting in 3 of 4 runs**; memory then *looked* lower because nothing got highlighted. I rejected it. A heap cap (`--max-old-space-size`) has no effect at these heap sizes: the main isolate's JS heap is about 130 MB. |
| **AST LRU cache 100→20/30** | Lowered the JS heap by about 40 MB. It is within the noise for total RSS. I left it at 100. |
| **`shiki-js` instead of `shiki-wasm`** | No measurable memory win. Kept wasm. |
| **Disabling Chromium features** (spare renderer, MediaRouter, Translate, …) | **No measurable effect.** Electron does not create a spare renderer here anyway. It is kept because it is harmless. |
| **In-process GPU + network service** (`--in-process-gpu`, NetworkServiceInProcess) | Drops to 2 processes: idle RSS 391 MB instead of 488, but footprint only −14 MB. The RSS saving is mostly shared framework pages that are no longer double-counted. **Cold start rose from about 410 to about 960 ms**, and a GPU crash would take down the app. Rejected. |
| **`backgroundThrottling`** | It is left `true`. Both windows stay visible in these scenarios, so it has no measurable effect. It only matters for hidden or minimized windows, where it saves CPU. |
| **V8 code cache** (`codeCache` scheme privilege + `v8CacheOptions: 'bypassHeatCheck'`) | The first launch after a rebuild takes about 700 ms; warm launches take about 420 ms. |
| **120 Hz** | Works out of the box at 180 Hz. No flags are needed. |

**Budget verdict (noisy).**
- Frames, switch and smooth scrolling: these clearly meet the budgets.
- Memory: this is the risk. The heavy session is right at the 1 GB RSS line: 928–1020 MB summed RSS, about 730–800 MB footprint. The summed-RSS metric over-counts Electron's shared framework pages across 4 processes by roughly 200 MB. The renderer's footprint breaks down roughly as follows (per `vmmap`): about 350 MB in the V8 sandbox, which is the main isolate plus the workers, and about 100 MB in PartitionAlloc.
- Remaining memory levers I did not try:
  - Terminate idle workers after N seconds; T3 Code does this with a 30 s TTL.
  - Parse the 290k patch lazily or in a worker. That would also remove the 190 ms main-thread parse.
  - Drop highlighted ASTs of off-screen files.

## Design constraints (what is easy, hard or impossible in Electron)

- **Blur and vibrancy.** Native `vibrancy`/`visualEffectState` on `BrowserWindow` is available on macOS, and it composes with CSS `backdrop-filter`. It is easy, but it is window-level or behind-content, not per-element native material.
- **Shadows, rounded clipping, gradients.** Trivial in CSS. The segmented control and chips here are plain CSS.
- **Animation and springs.** CSS transitions, WAAPI and `@starting-style` all work, and spring libraries run at the display rate. Pierre itself has a critically damped spring for smooth `scrollTo`.
- **Custom fonts.** Easy (`@font-face`). I used system fonts (Inter and JetBrains Mono are not installed); Pierre takes `--diffs-font-family` and friends.
- **Text selection and copy.** Native selection works inside Pierre's shadow DOM, and Pierre also has line-range selection. Copying a selection that spans virtualized-out rows would need custom handling.
- **IME and accessibility.** You get the Chromium stack for free: VoiceOver, IME and focus handling. The Pierre code view is a `<pre>`/grid in shadow DOM, so its accessibility is adequate but not a native table.
- **Hover cards, popovers, menus.** Hover cards and popovers are easy (DOM, Popover API, anchor positioning). Native menus are easy via `Menu`; I used a native menu item plus an accelerator for the pop-out. The shadow DOM means you style Pierre through its CSS variables and `unsafeCSS`, not your global CSS.
- **Drag and drop.** HTML5 DnD works. `startDrag` is available for native file drags.
- **Titlebar.** `titleBarStyle: 'hiddenInset'` with a `-webkit-app-region: drag` header gives the custom segmented titlebar with native traffic lights.
- **Multi-window.** The pop-out shares the renderer only if it is opened with `window.open` from the opener with the same origin. That means it must be a custom privileged scheme (or http), not `file://`. It also cannot be `noopener`. A window created independently with `new BrowserWindow` always gets its own renderer, adding about 340 MB in this test. The consequence is that one renderer crash or hang takes down both windows, and they share one main thread: a 190 ms parse in one window stalls the other's frames.
- **Pierre integration gotchas:**
  - A patch-only diff (with no full file contents) highlights hunk by hunk, which is fine.
  - Pierre's worker pool **can fail to initialize silently**. I saw it once under heavy load: all text stayed plain and nothing surfaced. The memory bench now records viewport coverage so that a run with nothing highlighted is visible.

## Dev friction

- The whole spike took about 2.5 hours, including all the A/B runs.
- Builds are instant: 0.6 s Vite, no native compile, and live reload is available.
- **Bun and Electron.** Bun does not run Electron's postinstall. `bun pm trust` said the package was already trusted, but `dist/` was missing. Running `node -e "require('electron')"` (or `node node_modules/electron/install.js`) downloads the binary.
- **Vite plugin-react 6.** The React Compiler moved to `@rolldown/plugin-babel` + `reactCompilerPreset()`, which adds 2 more dev dependencies. After that it just works.
- **Pierre API churn.** The `CodeView` generics differ between the npm 1.5.1 package (`<LAnnotation, Caret>` in d.ts) and T3 Code's pinned version. The docs, the skill references in the repo and T3's `StyledDiffCodeView` / `DiffWorkerPoolProvider` were enough to get going quickly.
- **Vite bundling.** Vite emits every Shiki grammar and theme as lazy chunks, making `dist/` 12 MB. Only Rust and `pierre-light` load at runtime.
- **The measurement itself.** The first coverage probe used `elementFromPoint`. It lied, because Pierre sets `pointer-events: none` while scrolling, so I switched to a geometry-based probe. Measuring whether frames are *correct* takes more care than measuring whether they are *smooth*.
- **Pop-out unification (not done).** Rendering a React portal into an `about:blank` child would share one JS realm. I did not do this: the `window.open` same-origin route was simpler, and it gave the same single process.

## Attribution

- **Electron** (MIT). **React / react-dom / babel-plugin-react-compiler** (MIT). **Vite, @vitejs/plugin-react, @rolldown/plugin-babel** (MIT). **@babel/core** (MIT).
- **`@pierre/diffs`** (Apache-2.0, © The Pierre Computer Company), which bundles **Shiki** (MIT) and vscode-oniguruma (MIT). The theme is `pierre-light`.
- **T3 Code** (MIT). The worker-pool setup (`?worker` import of `@pierre/diffs/worker/worker.js`, `tokenizeMaxLineLength: 1000`, `shiki-wasm`) and the CodeView styling approach were cribbed from `apps/web/src/components/DiffWorkerPoolProvider.tsx` and `diffs/StyledDiffCodeView.tsx`.
- **Fixtures.** Diffs of herdr (Apache-2.0).
- **`@pierre/trees`** is not used: the spec'd screen has no file tree, so I left it out to keep parity with the GPUI screen.
