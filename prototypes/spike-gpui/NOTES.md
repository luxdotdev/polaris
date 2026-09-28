# Spike 1: GPUI + gpui-kit (ENG-184)

Throwaway prototype of the review screen from `SPEC.md`. It is built on GPUI and gpui-kit, and measured with the shared scenarios.

## Build and run

Requirements: Rust 1.98 (stable) and macOS. The fixtures are read from `SPIKE_FIXTURES`, which defaults to `../../../spike-fixtures` relative to this crate (the scratchpad copy).

```sh
cd prototypes/spike-gpui
cargo run --release                 # the app, with the 10k diff (SPIKE_DIFF=40k|290k to change it)
./bench.sh                          # every scenario, results/gpui-<scenario>.json
./target/release/spike-gpui --bench scroll-290k   # a single scenario
./target/release/spike-gpui --hl-stats            # headless: parse + highlight throughput
```

Keys: ⌃1…⌃9 select a Workspace. ⌘⇧O (or **View ▸ Pop Out Diff**) opens the pop-out window. ⌘Q quits.

**The screen must be unlocked and awake while benchmarking.** GPUI's macOS backend stops a window's display link whenever the window is not `NSWindowOcclusionStateVisible`. That covers a locked screen, another Space and a covered window. In those states nothing draws, so frame waits would hang. `bench.sh` refuses to run on a locked screen (override with `FORCE=1`). Each scenario also has a 120 s watchdog that writes `{"error": …}` and exits. Every result JSON records `screen_locked`.

## What is built

- **Titlebar.** gpui-kit `TitleBar` (transparent, traffic lights inset) with a `ButtonGroup` segmented control for Orchestrate / Review / Edit. It switches only its own selected state.
- **Workspace bar.** One chip per Workspace in `sessions.json` order (10 Workspaces), each showing its host and ⌃N hint. ⌃1…⌃9 are real `KeyBinding`s to actions `Ws1…Ws9` handled on the root view.
- **Input column.** 260 px wide. Lists the Sessions of the selected Workspace, each with a colour dot for its Session State (working, needs, idle, dormant, terminal, failed).
- **Output pane.** A virtualized unified diff built on GPUI's `uniform_list`, so only the visible rows are laid out and painted. Rows are fixed at 20 px.
  - Diff parsing is our own (`src/diff.rs`). It produces one flat row list of file header, hunk header, context, add and del rows, all text stored in one `String` with offsets.
  - The **sticky file header** is an absolutely positioned overlay of the file owning the top visible row.
  - Old and new line-number gutters, a +/− sign column, and add/del backgrounds on both line and gutter.
  - JetBrains Mono at 12.5 px for code and Inter for UI. Both are **embedded** and registered at runtime via `text_system().add_fonts`, because neither is installed on this Mac.
  - **Rust syntax highlighting** uses gpui-kit's `SyntaxHighlighter` (tree-sitter-rust plus its highlight queries) with gpui-kit's default light highlight theme.
- **Pop-out.** A second GPUI window in the same process, with its own `DiffPane` and its own highlight store. It opens from the menu or the key.

### How highlighting works

For each file, the diff's hunks are stitched back into an **old source** (context + del) and a **new source** (context + add). Each source is parsed once as a whole, so multi-line constructs such as strings, comments and attributes highlight correctly. The resulting ranges are then split into per-line spans that index a small per-file style palette (8 bytes per span).

The work runs on **2 background threads**. Files nearest the viewport go first: the view publishes the file of its top row every frame, and workers search outward from it. When highlighting lands for rows that were shown plain, a 16 ms poll repaints.

Each worker reuses one `SyntaxHighlighter`. Constructing one compiles the Rust queries, which takes about 20 ms, and reuse made full-document highlighting about 6× faster. Non-`.rs` files are shown plain. The benches report honestly how often a frame showed visible rows without highlighting (`frames_with_unhighlighted_visible_rows`, `first_frame_fully_highlighted`, `jumps_first_frame_unhighlighted`).

### How frames are measured

- **Primary source: GPUI's own frame trace.** The `profiler` feature of `gpui-pre` and `FrameTimingCollector` provide `FrameEvent::Draw` (`Window::draw` start and end) and `FrameEvent::Present`. `present_end` is when the frame was submitted to Metal. We use present intervals for scrolling and the first present after a render for latencies.
- **Backup source: a paint marker.** A zero-size `canvas` is painted last in each view and records `Instant::now()`. We need it because GPUI's profiler **discards Present events for frames it considers invisible**, including the very first frame of a window, which is drawn before the window is ordered on screen. When no Present arrives within about 50 ms, the paint timestamp is used, and `present_fallbacks_to_draw_end` counts how often that happened. Scroll results report both `present_intervals_ms` and `paint_marker_intervals_ms`.
- **Scrolling.** `DiffPane::render` advances the scroll offset by `4000 px/s × dt` and calls `window.request_animation_frame()`, so the frame loop is driven by GPUI's display link at display rate.
- **Switch.** `window.dispatch_action(Ws<N>)` goes through exactly the path ⌃N takes. Latency runs from dispatch to the first present after the root view rendered the new Workspace.
- **Cold start.** The kernel's process start time (`proc_pidinfo`, `pbi_start`) to the first frame showing the sidebar and the 10k diff. The 10k diff is parsed synchronously before the window opens, which takes about 1.5 ms. `bench.sh` runs 5 launches and reports the median.
- **Memory.** `ps -A -o pid=,ppid=,rss=,comm=`, summed over our process tree, excluding the `ps` child itself. GPUI is a single process with no helpers.

## Sanity numbers (NOISY: read the caveats)

Taken on the M2 Max while the Electron spike was building in parallel. **The screen was locked for the whole session**, so no frame-dependent scenario could run; see the next section. Only these ran:

| What | Result |
|---|---|
| First full release build (about 860 crates) | **93 s wall** (686 s CPU), with the other agent building in parallel |
| Incremental release rebuild of the spike crate | about 3 s |
| Release binary | 23 MB (16 MB stripped) |
| Read + parse diff, 10k / 40k / 290k | 1.5 / 16 / 167 ms |
| Tree-sitter highlight of the whole document, 2 threads, 10k / 40k / 290k | 0.21 / 0.68 / 1.98 s |
| `cold-start` (process start → first frame, 3 warm launches)\* | 214 / 222 / 273 ms. Process start → `main` is 6–8 ms; `main` → first frame is 208–265 ms |
| `cold-start`, first launch after relinking | 626 ms, of which 372 ms is before `main` (macOS scanning the new binary) |
| `memory-idle` (10k diff, one window, 10 s)\* | 114 MB RSS, 1 process |
| Headless process after parsing and highlighting all three fixtures (no window) | 109 MB RSS |

\* Screen locked: the window drew only its first frame. The memory figure is therefore a lower bound for a visible, settled window, and the cold-start frame was timed from the paint marker.

The `main` → first frame time is dominated by GPUI and gpui-kit startup rather than our work (the diff parse takes 1.5 ms). gpui-kit enables `gpui_platform/runtime_shaders`, which compiles the Metal shaders from source at launch. Cargo features are additive, so we cannot turn this off without forking gpui-kit's manifest. Precompiled shaders (which need Xcode's `metal` tool at build time) would probably cut this. Not verified.

## Scenario status

All eight scenarios are implemented behind `--bench <id>` and run by `bench.sh`: `cold-start`, `open-diff`, `scroll-10k`, `scroll-40k`, `scroll-290k` (plus 20 random jumps), `switch`, `memory-idle` and `memory-heavy` (40k in the main window, 290k in the pop-out, both scrolled, 10 jumps in the pop-out).

`memory-idle` and `cold-start` ran. `cold-start` timed its first frame through the paint-marker fallback. The later "visible rows highlighted" frame never drew on the locked screen, so that field is `null`. The frame-driven scenarios (`open-diff`, `scroll-*`, `switch`, `memory-heavy`) are **untested end to end** and need a run on an unlocked screen.

## Design constraints

Legend: *built* means exercised in this spike. *Source* means verified in the pinned `gpui-pre 0.3.6` / `gpui-component 0.6.6` source but not exercised here.

- **Virtualized lists**, *built*. `uniform_list` is the natural fit when rows share one height. Variable-height rows (for example taller file headers, wrapped lines or inline comments) need `list()`, which measures items, or a precomputed height index. We kept headers at the row height and drew a taller sticky header as an overlay.
- **Custom fonts**, *built*. Embedding TTF/OTF bytes and calling `add_fonts` is easy. Families are then addressed by name.
- **Syntax highlighting**, *built*. Easy with gpui-kit's highlighter, but its API is shaped around an editor buffer (`Rope`, `update`, `styles(range)`). Diff-aware highlighting (stitching old and new sides) was ours to write. Constructing a highlighter compiles the queries, so it has to be pooled.
- **Blur and vibrancy**, *source*. There is window-level `WindowBackgroundAppearance::Blurred` (an `NSVisualEffectView` behind the whole window). There is **no per-element backdrop blur** (no `backdrop-filter` equivalent), so frosted sidebars or popovers over content are not available without custom Metal work.
- **Shadows**, *built*. Box shadows (`shadow_sm`…`shadow_2xl`, or custom `BoxShadow`) work, and the sticky header uses one.
- **Rounded clipping**, *source*. Rounded corners and borders render fine, but content masks are **rectangular only** (`ContentMask { bounds }`). Children overflowing a rounded container are clipped to its rectangle, not its radius. Rounded image or avatar clipping needs rounded images or overlays.
- **Animation and springs**, *source*. `with_animation` supports easing, and this snapshot ships a `SpringConfig` damped-spring module. gpui-kit adds motion helpers. Inactive windows are throttled to 30 fps by default (`inactive_frame_interval`), and `App::reduce_motion` is exposed.
- **Text selection and copy**, *not built*. `StyledText` and `div` are not selectable by default. gpui-kit has a `text::window_selection` module for its `TextView`, and Zed has its own editor. A selectable diff means hit-testing `TextLayout::index_for_position` across virtualized rows ourselves. This is the biggest gap compared with a DOM.
- **IME**, *source*. GPUI has a platform `InputHandler` with marked text, which Zed and gpui-kit `Input` use, so text inputs get IME. Custom widgets must implement `EntityInputHandler`.
- **Accessibility**, *source*. `gpui-pre` 0.3.6 integrates AccessKit (`accesskit_macos`), with a guide in `_accessibility.rs`. It is opt-in per element (roles and labels). It is newer and far less battle-tested than Chromium's tree, and not verified here.
- **Hover cards, popovers and tooltips**, *source*. gpui-kit has `hover_card`, `popover` and `tooltip`, plus `menu::PopupMenu`. They are drawn inside the window and **clipped to the window bounds**. For menus, gpui-kit's `native_menu::NativeMenu` renders an OS menu that can escape the window.
- **Native menus**, *built*. The menubar comes from `cx.set_menus` as a real `NSMenu`, and items dispatch GPUI actions. Context menus can be native (gpui-kit `NativeMenu`) or GPUI-drawn.
- **Drag and drop**, *source*. In-app drag uses `on_drag`/`on_drop` with typed payloads. External file drops arrive as `ExternalPaths`. The macOS window adopts `NSDraggingSource`, but dragging content out to other apps is limited compared with the web.
- **Multiple windows**, *built*. Trivial: each `cx.open_window` window is a separate `NSWindow` in the same process, sharing entities, so the pop-out can share the same `Arc<Doc>` data with no IPC.
- **Occlusion**, *hit*. There are no frames while a window is occluded. That is good for battery, but anything time-driven must not assume rendering continues (for example "wait for the next frame" logic).

## Dev friction

- **Pinning.** gpui-kit 0.6.6 pins `gpui-pre =0.3.6` exactly, and we pinned the same. Resolution was clean, about 860 crates.
- **API churn.** The API is already moving. The shallow clone of gpui-kit `main` has `gpui_kit::open_window`, but the published 0.6.6 does not, so we reimplemented it (8 lines). Examples in the repo track `main`, not the published crate, so expect small mismatches between examples and the release.
- **Docs.** Docs are thin but the source is readable. Everything here was found by reading `gpui-pre` source: `uniform_list`, `ScrollHandle::set_offset`, `profiler::FrameTimingCollector`, `on_next_frame`/`request_animation_frame`, and the occlusion behaviour. Traits must be imported to see builder methods (`prelude::FluentBuilder` for `.when`, `Selectable` for `.selected`), and the compiler hints help.
- **Frame instrumentation is good.** The `profiler` feature gives Draw and Present timestamps per window in a 16 MB ring buffer. The one surprise is that presents of "invisible" frames are dropped silently, including the first frame.
- **Compile times.** A cold release build took 93 s on the M2 Max (while contended). Edit and rebuild of the spike crate takes about 3 s.
- **Time spent.** About 2.5 hours in total: about 30 min reading gpui-kit and GPUI source, about 1 h writing the screen, parser and highlighter, and the rest on bench plumbing, the profiler's invisible-frame behaviour and the locked screen.

## Attribution

- **GPUI** (`gpui-pre` 0.3.6, a snapshot of Zed's crates, zed-industries/zed): Apache-2.0. Frame-trace usage was modelled on gpui-kit's `gpui-fps` crate (`crates/fps/src/sampler.rs`).
- **gpui-kit / gpui-component** 0.6.6 (longbridge/gpui-kit): Apache-2.0. Used for `TitleBar`, `ButtonGroup`, theme and `Root`, and for `SyntaxHighlighter` with the tree-sitter-rust queries and default light highlight theme. The local `open_window` helper is adapted from gpui-kit `main` (`crates/kit/src/lib.rs`).
- **tree-sitter** and **tree-sitter-rust**: MIT, via gpui-component.
- **JetBrains Mono** (JetBrains): SIL OFL 1.1, `assets/fonts/OFL-JetBrainsMono.txt`.
- **Inter** 3.19 (Rasmus Andersson): SIL OFL 1.1, `assets/fonts/OFL-Inter.txt`.
- **Fixtures**: herdr diffs (Apache-2.0), read from the shared fixtures directory and not copied.
