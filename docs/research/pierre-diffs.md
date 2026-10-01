# Pierre Diffs for the Review view

Research for [ENG-218](https://linear.app/luxdev/issue/ENG-218) (map: [ENG-217](https://linear.app/luxdev/issue/ENG-217), M2 · Review). Researched 2026-10-01.

- **Question:** Can Pierre Diffs carry M2's Review view, and on what terms? That covers licence, API, theming with our `--color-syntax-*` tokens, very large diffs at display rate in Electron, hooks for Risk Findings, comment threads and the composer, per-file collapse and Viewed, word-level diffs, and bundle and memory cost. If it falls short, what is the fallback?
- **Sources:** primary sources only. `pierrecomputer/pierre` read at [`3e0ee20`](https://github.com/pierrecomputer/pierre/tree/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214) (2026-09-30), npm `@pierre/diffs` 1.5.1 (latest, 2026-09-25), and the maintainers' issues and PRs. Links below are relative to that commit (`P/` = `https://github.com/pierrecomputer/pierre/blob/3e0ee20…/`).
- **Builds on** [`bun-web-stack.md`](bun-web-stack.md) §1 (ENG-183), which covered Pierre's maturity, architecture and the "On rendering diffs" numbers. Those are not repeated here.
- **[measured]** marks numbers from a throwaway spike on this machine: Apple M2 Max, 32 GB, macOS 27, Electron 44.4.5 (the Desktop App's pin), a display running at about 180 Hz (5.5 ms frames). The spike code is on the branch `prototype/pierre-diffs-spike`, outside the product code.

## TL;DR

1. **Licence: Apache-2.0**, and so is every `@pierre/*` dependency. The rest of the tree is MIT, with `diff` under BSD-3-Clause. One catch: Pierre writes `"license": "apache-2.0"` in lowercase, and our `scripts/licenses.ts` compares SPDX ids case-sensitively, so `bun run licenses:check` would flag all three `@pierre/*` packages. SPDX ids are case-insensitive, so fix the checker. Don't add exceptions.
2. **API fit is good.** `CodeView` is one virtualized scroll region over `{ type: 'diff', fileDiff }` items, with stable ids, a `version` bump per change, `collapsed`, `annotations`, `scrollTo` by item, line or range, sticky headers, header slots, viewer-wide line selection, a hover gutter button, and a non-virtualized header and footer. The Daemon's `git.diff` already returns a unified patch, which goes straight into `parsePatchFiles`. React and vanilla APIs both exist.
3. **Performance holds at display rate [measured].** In Electron 44 with the worker pool, fast scrolling held p95 ≈ 6.5 ms and p99 ≈ 6.9 ms against 5.5 ms frames, with no long tasks. That held for 5,000 files (260k patch lines), 20,000 files (1.04M lines), a 100k-line file with 4,000 hunks, and a 300k-line added file. **Without workers**, the 5,000-file case dropped 125 of 600 frames. So the worker pool is mandatory.
4. **Parse the patch, not the files [measured].** `parsePatchFiles` on a 100k-line, 4,000-hunk patch takes 44 ms. `parseDiffFromFile` on the same change takes 3.0 s in Electron and 7.7 s in Bun, all on the main thread. Review must render git's patch, then use `loadDiffFiles` only to expand context.
5. **Memory is the real risk [measured].** Total app working set: 345–385 MB with nothing loaded, about 750–800 MB with 5,000 files, and 1.18–1.39 GB with 20,000 files. Most of that sits in the renderer process (workers and rendered output). The JS heap stays at 60–160 MB. The < 1 GB app budget therefore covers a few-thousand-file Review in a bare shell, but not the largest ones.
6. **Theming works through a CSS-variable Shiki theme [measured].** `registerCustomTheme` accepts a theme whose colours are `var(--color-syntax-*)`. The variables resolve through the shadow DOM, and the worker pool accepts the theme. Shiki's built-in `createCssVariablesTheme` has no separate "type" token, so write our own six-scope theme. The DESIGN.md token map's Pierre variables all exist at this commit.
7. **Hooks: comments yes, line marks not yet.**
   - **Comment threads, drafts and the composer:** `renderAnnotation`, the gutter-utility "+" with `onGutterUtilityClick(range)`, and line selection. Pierre's own Apache-2.0 `diffshub` app is a working reference.
   - **File-level badges and the Viewed checkbox:** header slots.
   - **Word-level diffs:** built in (`lineDiffType`, default `word-alt`).
   - **Missing:** a public API for per-line decorations, which the flagged-line Severity glyph and 2px rule need. It exists only as Pierre's draft PR #459 ("Decorations v3": per-item `decorations: [{ lineNumber, endLineNumber, side, bar, background }]`). Also missing: custom gutter columns (#306) and a built-in Viewed state.
8. **Verdict: yes, Pierre Diffs can carry M2's Review**, on four conditions:
   - pin an exact version (and patch it if needed);
   - always run the worker pool;
   - feed it git patches;
   - add a Daemon read of a file at a revision, for context expansion.

   Ship flagged lines as an annotation row first. Move to Pierre's Decorations API when it lands, or contribute it. A per-instance `unsafeCSS` hack would carry no compatibility promise.
9. **Fallback:** Polaris's own virtualized unified renderer. Grow the session view's `model/diff.ts` and `@tanstack/react-virtual` (both already in the app), with Shiki or `@pierre/highlights` in a worker. Use CodeMirror 6 `@codemirror/merge` (MIT) only for single-file, editable diffs. Neither gives a multi-file virtualized review region out of the box. That region is Pierre's main value, so the fallback costs weeks, not days.

## 1. Licence and package

| | |
|---|---|
| Package | [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) 1.5.1, released 2026-09-25. Releases are roughly weekly: 1.4.0 (09-04), 1.4.1, 1.4.2, 1.4.3, 1.5.0 (09-24), 1.5.1 (`npm view @pierre/diffs time`) |
| Licence | Apache-2.0 ([`LICENSE.md`](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/LICENSE.md)). The npm tarball has `LICENSE.md` and no NOTICE file |
| Runtime deps (npm) | `@pierre/theme` 2.0.0 and `@pierre/theming` 1.0.1 (Apache-2.0), `shiki` ^3‖^4 and `@shikijs/transformers` (MIT), `diff` 9.0.0 (BSD-3-Clause), `hast-util-to-html` (MIT), `lru_map` (MIT). All are on our allowlist |
| Peer deps | `react` and `react-dom` ^18.3.1‖^19, both optional |
| Entry points | `.`, `/react`, `/ssr`, `/edit`, `/worker`, `/worker/worker.js`, `/worker/worker-portable.js` |
| Unpacked size | 7.4 MB (`dist.unpackedSize`) |

**Our licence check.** Pierre's `package.json` says `"license": "apache-2.0"`. [`scripts/licenses.ts`](../../scripts/licenses.ts) `isAllowed` looks tokens up in `ALLOWED` exactly, so `apache-2.0` misses `Apache-2.0`, and `licenses:check` would report a violation for `@pierre/diffs`, `@pierre/theme` and `@pierre/theming`. SPDX licence ids are case-insensitive, so the right fix is to normalise case in the checker, not to list exceptions.

**Copying code.** Depending on the package needs no attribution beyond THIRD_PARTY_NOTICES. Pierre's `apps/diffshub` (the review UI at diffshub.com) is Apache-2.0 too ([`apps/diffshub/LICENSE.md`](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/diffshub/LICENSE.md)). If we adapt its comment or collapse code, that falls under AGENTS.md's attribution rule: pin `3e0ee20` and add an `ATTRIBUTION.md` entry. Its NOTICE covers only a bundled JetBrains Mono subset (OFL-1.1), which we wouldn't take.

## 2. Rendering a PR's or a Turn's diff

**Data in.** Both cases are a unified patch from the Daemon: `git.diff` with `Range { base, head }` for a PR and `Turn { sessionId, turnId }` for a Turn. It arrives as a blob ([`packages/protocol/src/rpc.ts`](../../packages/protocol/src/rpc.ts) `GitDiff`).
- `parsePatchFiles(patch)` gives `ParsedPatch[]`, each with `files: FileDiffMetadata[]`. Patch-derived metadata is *partial* (no full file contents).
- Showing more context (`expandUnchanged`, `expandHunk`) or editing needs `loadDiffFiles(partial) → { oldFile, newFile }`. Without it those paths throw ([CoreTypes docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/CoreTypes/content.mdx), [VanillaAPI docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/VanillaAPI/content.mdx)).
- **Gap:** `files.read` reads the working tree, and no RPC reads a path *at a revision*. Review needs one, for the base side and for a Review Checkout at a given SHA.

**The view.** `CodeView` ([docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/CodeView/content.mdx)):
- **Items.** It takes `CodeViewItem[]` (`{ id, type: 'diff', fileDiff, annotations?, collapsed?, version? }`). Items are mutable records: after a change, bump `version` and call `updateItem`. The data model deliberately skips deep equality.
- **Two ownership modes in React.** Controlled (`items`) or imperative (`initialItems` plus a ref with `addItems`, `updateItem`, `removeItem`). Pierre recommends imperative mode for "very large or streaming lists". That suits a Turn still streaming in.
- **Scrolling and selection.** `scrollTo({ type: 'item' | 'line' | 'range' | position })` resolves against measured layout, so a click on a finding in the risk column can land on `file:line`. Selection is viewer-wide: `{ id, range }`.
- **Header and footer.** `renderCodeViewHeader` and `renderCodeViewFooter` render non-virtualized content at the two ends of the scroll region. Pierre suggests them for "PR summary cards and approval bars".
- **Diff options** ([`types.ts` L418-462](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/types.ts#L418-L462)):
  - `diffStyle: 'unified' | 'split'` (split is the default; Review wants unified);
  - `diffIndicators: 'classic' | 'bars' | 'none'`;
  - `hunkSeparators`;
  - `overflow: 'scroll' | 'wrap'`;
  - `tokenizeMaxLineLength` and `maxLineDiffLength` (default 1000), which guard against very long lines;
  - `expansionLineCount`.

**Agent-session diffs grouped by Turn.** CodeView items are only files and diffs. Nothing renders an arbitrary row between items, and the header and footer sit only at the two ends. Three ways to draw the Turn divider DESIGN.md asks for:
- (a) render it in the first file's header for each Turn (`renderCustomHeader` or `renderHeaderPrefix`);
- (b) use one CodeView per Turn, and give up a single scroll region;
- (c) use the lower-level `Virtualizer` with mixed DOM, which Pierre warns "can blank more easily … and is generally less performant" ([Virtualization docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/Virtualization/content.mdx)).

(a) is the cheapest and keeps one region. "Reviewed turns collapse to one line" then means collapsing that Turn's items.

## 3. Syntax highlighting and themes

- **Shiki.** Pierre highlights with Shiki 3 or 4, using the JS regex engine by default; `preferredHighlighter: 'shiki-wasm'` switches to Oniguruma.
- **Theme option.** `theme` is a bundled or registered theme name, or a `{ dark, light }` pair. `themeType` is `'system' | 'light' | 'dark'`.
- **How a theme reaches the page.** Its `fg` and `bg` become `--diffs-fg` and `--diffs-bg` on the host ([`getHighlighterThemeStyles.ts` L37-52](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/utils/getHighlighterThemeStyles.ts#L37-L52)). Token colours are inline styles on spans.
- **Pierre's experimental highlighter.** Pierre also ships `@pierre/highlights`, a WebAssembly highlighter with 73 lexers and no grammar downloads. It is labelled "experimental and subject to change" ([docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/HighlightsHighlighter/content.mdx)). It isn't a `preferredHighlighter` option yet (`HighlighterTypes = 'shiki-js' | 'shiki-wasm'`).

**Driving it from `--color-syntax-*`.**
- `registerCustomTheme(name, loader)` takes any Shiki `ThemeRegistration` ([`registerCustomTheme.ts`](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/highlighter/themes/registerCustomTheme.ts)).
- A theme whose `tokenColors` are `var(--color-syntax-keyword)` and so on renders those strings into the spans. **[measured]** The spike's shadow DOM contained `var(--color-syntax-…)` with and without the worker pool. The worker pool receives themes already resolved on the main thread ([`WorkerPoolManager.ts`](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/worker/WorkerPoolManager.ts)).
- Custom properties inherit into shadow DOM, so the `light-dark()` tokens in `packages/ui/src/styles/tokens.css` switch with `color-scheme`. Pass `themeType` to match the app's appearance, so Pierre's own light and dark rules agree.
- One theme then serves both appearances. There's no need for a dark/light pair or for re-highlighting on an appearance change, which a hex theme would force through `setRenderOptions` and a cache flush.
- Use a hand-written theme, not `registerCustomCSSVariableTheme`. That helper wraps Shiki's `createCssVariablesTheme`, which maps `entity.name.type` into `token-function` and has no type token ([shiki `createCssVariablesTheme`](https://github.com/shikijs/shiki/blob/main/packages/core/src/theme-css-variables.ts)). Moonlit needs keyword, string, type, function, comment and punctuation separately.
- Set the theme's `bg` to a Polaris variable such as `light-dark(surface-raised, surface-sunken)`, never `var(--diffs-bg)`. Pierre writes `--diffs-bg` *from* the theme's `bg`, so that would be self-referential.

**DESIGN.md's token map holds.** At `3e0ee20`, every variable in DESIGN.md's "Diff (Pierre Diffs)" table appears in [`style.css`](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/style.css): `--diffs-font-family`, `-font-size`, `-line-height`, `-header-font-family`, `-bg`, `-fg`, `-fg-number`, `-addition-` and `-deletion-color-override`, `-bg-addition`, `-deletion`, `-addition-emphasis` and `-deletion-emphasis-override`, `-bg-separator-override`, `-bg-hover-override` and `-bg-selection-override`.

`unsafeCSS` is injected as `@layer unsafe` inside the shadow root. Pierre says: "We cannot currently guarantee backwards compatibility for this feature across any future changes to the library, even in patch versions" ([Styling docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/Styling/content.mdx)). Keep it to selectors on Pierre's `data-*` attributes and re-check it on every upgrade.

## 4. Very large diffs at display rate

**What Pierre provides.**
- Per-line virtualization in `CodeView`, with measured-height reconciliation, DOM pooling and "inverse sticky" anti-blanking (see `bun-web-stack.md`).
- Scroll rebasing past 12,000,000 px. The native scroll container is capped and paged, and logical positions map onto it ([`CodeView.ts` L675-689](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/components/CodeView.ts#L675-L689)). With 20,000 files, the native scrollbar covers only the current page, not the whole diff. Review's file list and `scrollTo` become the way to move across a huge PR.
- A worker pool for Shiki: `poolSize` defaults to 8, and plain text renders first, with highlighting applied when a worker answers. It also has a render cache keyed by `cacheKey`. Both are "experimental … API is subject to change" ([WorkerPool docs](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/docs/app/(diffs)/docs/WorkerPool/content.mdx)). When the pool is used, `theme`, `lineDiffType`, `tokenizeMaxLineLength` and `useTokenTransformer` are set on the pool, not per component.

**Spike [measured].** Each scenario ran in a fresh Electron 44.4.5 window (1400×1000) in vanilla `CodeView`:
- options: unified diff, word-alt, sticky headers, gutter utility and line selection on, an annotation on every 10th file, and the `var()` theme;
- the worker pool used 4 workers unless noted;
- fast scroll was 600 frames at 240 px per frame (about 43,000 px/s), with the time between `requestAnimationFrame` callbacks recorded;
- 20 far jumps recorded the time to the next frame;
- memory is the total app working set from `app.getAppMetrics()`, with the renderer ("Tab") process in brackets.

| Scenario | Parse | `setItems` → first frame | Scroll p50 / p95 / p99 / max (ms) | Frames > 1.5× budget | App memory (renderer) |
|---|---|---|---|---|---|
| Empty viewer, pool of 4 | n/a | n/a | 5.5 / 6.6 / 6.9 / 11.4 | 1/600 | 385 MB (131) |
| 5,000 files, 15k hunks, 260k patch lines, 12.5 MB, pool of 4 | 196 ms | 19 ms | 5.6 / 6.4 / 6.9 / 11.9 | 2/600 | 802–854 MB (529–574) |
| same, pool of 2 / 1 | 200 ms | 21 ms | 5.5–5.6 / 6.4–6.7 / 6.9–10.1 / 11.9 | 3–6/600 | 744–765 MB (487–502) |
| same, **no workers** | 184 ms | 180 ms | 5.6 / **11.2 / 12.1 / 17.4** | **125/600** | 779 MB (477) |
| 20,000 files, 1.04M patch lines, 50 MB, pool of 4 / 2 | 761–774 ms | 62–70 ms | 5.6 / 6.5 / 6.9 / 10.4–16.6 | 1–4/600 | **1,177–1,387 MB** (915–1,078) |
| 1 file, 100k lines, 4,000 hunks, from a patch | 44 ms | 6 ms | 5.6 / 6.5 / 6.9 / 11.6 | 2/600 | 733 MB (481) |
| same, no workers | 37 ms | 88 ms | 5.6 / 6.4 / 10.5 / 22.1 | 6/600 | 1,175 MB (918) |
| same change via `parseDiffFromFile` (full texts) | **3,037 ms** | 6 ms | 5.5 / 6.6 / 6.9 / 10.5 | 1/600 | 757 MB (499) |
| 1 added file, 100k lines | 71 ms | 5 ms | 5.6 / 6.6 / 6.9 / 7.0 | 0/600 | 622 MB (380) |
| 1 added file, 300k lines | 232 ms | 4 ms | 5.5 / 6.6 / 6.9 / 7.0 | 0/600 | 674 MB (383) |

Reading it:
- **With workers, Pierre held the display's frame rate at every size tried**, including about 180 Hz. The 120 Hz target (8.33 ms) has headroom: p99 stayed under 7 ms. No long tasks fired during scrolling, and far jumps painted in ≤ 7 ms.
- **Without workers, highlighting runs on the main thread.** The 5,000-file case missed about 1 frame in 5, and memory went up, not down: the 100k-line case gained 437 MB in the renderer. The worker pool is not optional, even though it is labelled experimental.
- **Parse cost scales with the patch, and it sits on the main thread.** About 200 ms for 12.5 MB and about 770 ms for 50 MB, both before the first frame. A Review of that size wants parsing off the main thread: in a worker, or on the Daemon as pre-split per-file patches added with `addItems` in batches.
- **Never diff full texts in the renderer.** `parseDiffFromFile` runs jsdiff's Myers diff: 3.0 s in Chromium and 7.7 s in Bun for 100k lines (`bun src/parse-check.ts` on the spike branch). Git on the Daemon already did that work.
- **Memory.** A 20,000-file Review alone puts a bare Electron shell over the 1 GB app budget, and 5,000 files take about 80% of it. Pierre's own figure for the Linux v6→v7 diff is about 1.15 GB ("On rendering diffs"). Pool size made little difference (4 workers vs 1: about 50 MB). Polaris will need a ceiling: past some file or byte count, open the Review collapsed, and highlight and hydrate only expanded files.
- **Caveats.** The scroll loop measures how fast the main thread produces frames. It does not catch compositor-level blanking or what a trackpad flick feels like. Glyph, token and annotation density in a real repo will be heavier than this synthetic TypeScript. Check these in the Desktop App's e2e and bench before calling the budget met. Known upstream issues: OOM on "ginormous diffs" ([#760](https://github.com/pierrecomputer/pierre/issues/760), open, byte arenas proposed), and no horizontal virtualization for very long lines.

## 5. Hooks for the Review view

Mapped against DESIGN.md's "Review" section:

| Review need | Pierre support at `3e0ee20` | How |
|---|---|---|
| Inline comment threads under a line | **Yes.** `annotations: DiffLineAnnotation<T>[]` (`{ side, lineNumber, metadata }`; `lineNumber: 0` = file-level) and `renderAnnotation(annotation, item)`, which in React returns JSX through portals | [`FileDiff.ts` L287-289](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/components/FileDiff.ts#L287-L289), CoreTypes docs. Annotation heights are measured and kept in the virtual layout |
| Comment composer anchored to lines | **Yes.** `enableGutterUtility` shows a button on the hovered line, and `onGutterUtilityClick(range)` reports it. `enableLineSelection` with `onLineSelectionEnd(range)` covers multi-line ranges. The composer is a "draft" annotation at the range's end line | [`InteractionManager.ts` L217-239](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/managers/InteractionManager.ts#L217-L239). diffshub does exactly this ([`DiffsHubViewer.tsx` L369-485](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/diffshub/components/DiffsHubViewer.tsx#L369-L485)). There are no native multi-line comment ranges ([#499](https://github.com/pierrecomputer/pierre/issues/499)) |
| Inline Risk Finding (the expanded card in the diff) | **Yes**, as an annotation | Same as comment threads. Metadata carries the Finding id, so the risk column and the diff share one selection |
| Severity badge in the file header | **Yes** | `renderHeaderPrefix`, `renderHeaderFilenameSuffix`, `renderHeaderMetadata`, or `renderCustomHeader` to replace the header |
| Per-hunk badge | **Partly.** No hunk-level slot: `hunkSeparators` as a function is deprecated | An annotation on the hunk's first changed line. Or style the built-in separator through `unsafeCSS`, which can't carry per-hunk content |
| Severity glyph in the gutter and a 2px rule on the flagged line | **No public API.** `renderGutterUtility` is hover-only. Line decorations are `protected` renderer hooks ([`DiffHunksRenderer.ts` L829-870](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/packages/diffs/src/renderers/DiffHunksRenderer.ts#L829-L870)), and `CodeView` builds its own instances. Line selection allows only one range at a time (maintainer, [#499](https://github.com/pierrecomputer/pierre/issues/499)) | The answer is draft PR [#459 "Decorations v3"](https://github.com/pierrecomputer/pierre/pull/459) (opened 2026-03-31, still WIP): `decorations?: DiffDecorationItem[]` per CodeView item, with `{ lineNumber, endLineNumber?, side, bar, background }`. Related: custom gutter columns [#306](https://github.com/pierrecomputer/pierre/issues/306) and span decorations [#884](https://github.com/pierrecomputer/pierre/issues/884), both open. Interim: an annotation row, plus a generated `unsafeCSS` keyed on `[data-line="N"][data-line-type^="change-addition"]`, scoped per item by a host attribute set in `onPostRender`. That works but is brittle (no compatibility guarantee, DOM recycling) |
| Per-file collapse | **Yes** | `item.collapsed` plus a `version` bump and `updateItem`. The header stays visible. diffshub re-anchors the scroll when the collapsing file's top is above the viewport ([`DiffsHubViewer.tsx` L342-367](https://github.com/pierrecomputer/pierre/blob/3e0ee2091fcdf9cf4e57ae08c80a0d4f0c4c1214/apps/diffshub/components/DiffsHubViewer.tsx#L342-L367)). Watch [#1144](https://github.com/pierrecomputer/pierre/issues/1144): collapsing an *editable* item re-tokenizes synchronously (60–120 ms) |
| Viewed checkbox and "3 of 7 viewed" | **No built-in state.** The header slots host the checkbox | Polaris owns Viewed (Client state per Review subject and file, reset when the file's diff changes). Checking it collapses the file |
| Word-level diffs | **Yes, by default** | `lineDiffType: 'word-alt' \| 'word-line' \| 'word' \| 'char' \| 'none'`, with lines longer than `maxLineDiffLength` (1000) skipped. Rendered as `data-diff-span`, styled by the `-emphasis-override` variables. **[measured]** present in the spike |
| Turn dividers and reviewed-Turn collapse | **Indirect** | See §2 |
| "Ask the reviewer", summary card, accept bar | **Yes**, if inside the scroll region | `renderCodeViewHeader` and `renderCodeViewFooter`. The risk column stays outside |
| Fix a line while reviewing | **Experimental** | Edit mode (`/edit`, `createEditor` or `EditProvider`). No LSP. Out of M2 scope |

## 6. Bundle cost

**[measured]** A `bun build --minify --splitting` of a vanilla `CodeView` page:
- **Entry chunk:** 636 KB minified (179 KB gzip). It holds Pierre, Shiki core, the JS regex engine and `diff`.
- **Worker (`worker.js`):** 838 KB minified (303 KB gzip).
- **Languages and themes:** Shiki's full bundle adds about 400 lazy chunks, about 12 MB on disk, because Pierre imports `shiki`, not `shiki/core`. Only the grammars a diff uses load at runtime.

In Electron these load from disk, so gzip size doesn't matter. The 12 MB adds to the app download unless the build drops unused grammars. The React wrapper adds little on top; React is already in the renderer.

## 7. Fallback

If Pierre stalls (Decorations never land, a regression we can't patch, or memory we can't bound), the fallback is to **grow the session view's own renderer into Review's**. Concretely:
- **Parser:** `apps/desktop/src/renderer/features/session/model/diff.ts` already parses `git.diff`'s unified patch into files, hunks and lines. Move it into a worker.
- **Virtual list:** `@tanstack/react-virtual` 3.14.13 is already a Desktop App dependency. Lay rows out as one flat virtual list across files, with Polaris-owned rows for Turn dividers, Findings and comments. That gives native decorations and gutter glyphs.
- **Highlighting:** Shiki (`shiki/core` with only the grammars we use) or `@pierre/highlights` in a worker, emitting tokens styled by `--color-syntax-*`.
- **Word diffs:** `diff`'s `diffWordsWithSpace` per changed-line pair, capped at a length limit, as Pierre does.
- **Single-file editable diff:** CodeMirror 6 `@codemirror/merge` 6.12.2 (MIT), via `unifiedMergeView` with `diffConfig` scan limits and timeouts, and `collapseUnchanged`. CM6 is already the Editor's choice. It diffs full documents in the browser and is one editor per file, so it suits Editor-side diffs, not a 5,000-file PR.

Cost: Pierre's anti-blanking, scroll rebasing and height reconciliation are most of the work in this area, so expect weeks. Other MIT diff views exist (`@git-diff-view/react` 0.1.7, `react-diff-view` 3.3.3). Neither documents virtualization at this scale, and neither was evaluated further.

## 8. Open risks

- **Experimental layers we depend on:** the worker pool, the render cache and `unsafeCSS`. Pin an exact version, as T3 Code does (it carries a patch to `VirtualizedFile`), and re-run the bench scenarios on every bump.
- **Decorations API timing.** PR #459 has been a draft since March. If it slips past M2, flagged lines ship as annotation rows, without the gutter glyph or 2px rule DESIGN.md specifies.
- **Memory for huge Reviews** (§4). Needs a policy and a bench scenario.
- **No file-at-revision RPC** for `loadDiffFiles`.
- **Main-thread patch parse** for very large patches.
- **Licence-check casing** (`apache-2.0`).
- **Mobile.** Pierre is DOM and shadow DOM only; the React Native app will need its own diff view (as noted in `bun-web-stack.md`).

## What the decision tickets need

- **Adopt:** `@pierre/diffs` pinned exactly (1.5.1 or newer, bumped deliberately), with the React wrapper in imperative mode. The worker pool is always on; DESIGN.md's Performance rule "Long lists and diffs are virtualised" depends on it.
- **Protocol:**
  - add a "read a file at a revision" RPC (or `git.show`) for `loadDiffFiles`;
  - consider having `git.diff` return per-file patch offsets, so the Client can parse and add files in batches.
- **Licence script:** compare SPDX ids case-insensitively in `scripts/licenses.ts` before adding the dependency.
- **Design:**
  - the theme is a hand-written Shiki theme over `--color-syntax-*`, with `themeType` following the app;
  - flagged-line marks need Pierre's Decorations (#459), or an annotation-row interim that DESIGN.md accepts;
  - Turn dividers ride in the first file's header of each Turn;
  - Viewed is Polaris state.
- **Budget:** set a large-Review policy (for example, past N files or M MB, open collapsed and hydrate on expand). Add a Review scenario to `packages/bench` modelled on the spike: 5,000 files, 20,000 files, and a 100k-line file.
- **Upstream:** worth offering Pierre help on #459 and #306. Anthropic's design-systems team is already asking for the related span-decorations API (#884).
