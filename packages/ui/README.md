# @polaris/ui

Night watch in code: DESIGN.md's tokens and components for the Desktop App's renderer, built on shadcn/ui (Radix) and Tailwind CSS v4. React 19, written to compile cleanly under the React Compiler.

## Use

```tsx
import "@polaris/ui/styles.css"; // once, in the renderer entry (Tailwind v4 via @tailwindcss/vite)
import { Toaster, TooltipProvider } from "@polaris/ui";

<TooltipProvider>
  <App />
  <Toaster />
</TooltipProvider>;
```

The stylesheet imports Tailwind and scans this package with `@source`; the app's own CSS adds `@source` for its files. `react`, `react-dom` and `tailwindcss` are peer dependencies.

Root attributes (any element can set them for its subtree):

| Attribute | Values | Default |
|---|---|---|
| `data-theme` | `dark`, `light` | dark; with no attribute, the system appearance decides |
| `data-density` | `calm`, `balanced`, `compact` | calm |
| `data-reduce-motion` | `true` | follows `prefers-reduced-motion` |

## Tokens

`src/styles/tokens.css` is DESIGN.md's frontmatter plus the Paper file's token list, as a Tailwind `@theme static` (every variable is emitted, so components can use them from JS). Tailwind's palette, type scale, weights, radii and shadows are cleared: only Polaris tokens exist (rule/colour-means-something).

- **Colours** are `light-dark()` pairs resolved against the element's `color-scheme`, so one declaration covers both themes and a `data-theme` subtree flips everything under it. Utilities keep DESIGN.md's names: `bg-surface-sunken`, `bg-fill-selected`, `border-hairline`, `text-text-subtle`, `text-needs-you`, `bg-severity-high/16`, `text-harness-codex`, `bg-diff-added-bg`, `text-git-modified`, `text-syntax-keyword`…
- **Type**: `text-display`, `title`, `heading`, `heading-sm`, `body`, `label`, `caption`, `code`, `code-inline` (size, leading and weight together), plus `text-micro` (11/12) for keycaps and chip counts. Weights: `font-regular`, `font-medium` only. `font-sans` is the system face (SF Pro on macOS), `font-mono` is SF Mono, `font-pixel` is Geist Pixel for the wordmark only.
- **Density**: `h-row`, `h-tree-row`, `h-session-row`, `size-harness-tile`, `px-row-x`, `gap-gap`, `p-panel`, `gap-section` read the active density's values (rule/density-through-tokens).
- **Radii** `rounded-control|row|card|full`; **shadow** `shadow-float`; `tabular` and `pixelated` utilities.
- shadcn's semantic variables (`--background`, `--primary`, `--muted`, `--border`, `--ring`…) map onto these, so a stock shadcn component picks up Night watch.
- Washes, scenes and halos come from `design/assets` through per-theme variables in `assets.css` (images can't be `light-dark()` pairs).

`cn()` is tailwind-merge taught the Polaris scale; without that, `text-caption text-text-subtle` would lose the size.

## Components

Restyled shadcn (`src/components/ui`): Button (`primary`, `secondary`, `ghost`, `danger`), Tooltip, HoverCard, Popover, DropdownMenu, ContextMenu, Command (cmdk; `CommandDialog` is the K jump menu), Dialog (never for Connection State), Input, Textarea, Switch, Select, ScrollArea, Separator.

Polaris (`src/components/polaris`): IconButton, Kbd, Badge, Row (list, session and tree rows), SectionHeader, Tile, StateIcon, HarnessMark, SeverityBadge and SeverityGlyph, GitStatusLetter, SegmentedControl, Chip (workspace, source, add), Toast with `Toaster` and `showToast`, CodeWell, Scene and Clearing, Dither, Composer with HarnessPicker and WorkingStrip, ApprovalCard (the Needs You hover card), EmptyState (the pane tier), Wordmark.

- **StateIcon** follows DESIGN.md's state table exactly (`STATE_GLYPHS`), and takes the protocol's `SessionState` and `HarnessKind`. Only Working moves.
- **SeverityBadge** is always a labelled, shaped badge; states are unlabelled glyphs. The two never share a form (tested).
- **Dither** ports `design/scripts/gen_dither.py` (Bayer 4x4 over a moving wave, 2px cells): 12 frames baked into one SVG mask strip, stepped with `transform` at 83ms a frame, so it runs on the compositor. It fades in over 200ms; Reduce Motion stills it to frame 0. Frame 0 matches `design/assets/dither/dither-claude-16.svg` cell for cell (tested).
- **Icons**: `src/icons/chrome.tsx` holds 16px outline stand-ins drawn for Polaris; `src/icons/pixel.tsx` holds the pixel glyphs (hand, terminal and x-mark share gen_dither.py's paths; the star is its `star_cells()`).

## Gallery

```sh
bun run --cwd packages/ui gallery        # http://localhost:5199
```

One page with every component and state, dark and light side by side, and "Artboard 5", the chrome of Paper's `11U-0` rebuilt statically from these components. Query parameters make each state reachable for screenshots: `?page=components|orchestrate`, `?density=calm|balanced|compact`, `?theme=dark|light`, `?reduce=1`, `?chrome=0` (no gallery header), and on the artboard page `?hover=1` (artboard 1's approval card), `?k=1` (artboard 3's jump menu), `?toast=0`.

## Tests

`bun test` (happy-dom): the state→glyph table and its coverage of the protocol's states, that only Working moves, Severity vs State forms, low-confidence dimming (never Critical), every DESIGN.md `-dark`/`-light` pair as one `light-dark()` token, the theme selectors, the dither port against the committed asset, and `cn()`'s merging.
