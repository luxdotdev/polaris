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
| `data-theme` | `dark`, `midnight`, `light` | dark; with no attribute, the system appearance decides |
| `data-density` | `calm`, `balanced`, `compact` | calm |
| `data-reduce-motion` | `true`, `false` | follows `prefers-reduced-motion`; `false` keeps motion when the system asks to reduce it |
| `data-text-size` | `small`, `default`, `large`, `larger` | default (scales the type table only; density is separate) |
| `--code-size` (style) | a length | 13px: the `code` role's size at the default text size; `code-inline` is 1px smaller |
| `data-diff-palette` | `cvd` | the red/green diff palette; `cvd` swaps in blue/orange for diffs, fills and git letters |

## Tokens

`src/styles/tokens.css` is DESIGN.md's frontmatter plus the Paper file's token list, as a Tailwind `@theme static` (every variable is emitted, so components can use them from JS). Tailwind's palette, type scale, weights, radii and shadows are cleared: only Polaris tokens exist (rule/colour-means-something).

- **Colours** are `light-dark()` pairs resolved against the element's `color-scheme`, so one declaration covers both themes and a `data-theme` subtree flips everything under it. Utilities keep DESIGN.md's names: `bg-surface-sunken`, `bg-fill-selected`, `border-hairline`, `text-text-subtle`, `text-needs-you`, `bg-severity-high/16`, `text-harness-codex`, `bg-diff-added-bg`, `text-git-modified`, `text-syntax-keyword`…
- **Type**: `text-display`, `title`, `heading`, `heading-sm`, `body`, `label`, `caption`, `code`, `code-inline` (size, leading and weight together), plus `text-micro` (11/12) for keycaps and chip counts. Weights: `font-regular`, `font-medium` only. `font-sans` is the system face (SF Pro on macOS), `font-mono` is SF Mono, `font-pixel` is Geist Pixel for the wordmark only.
- **Density**: `h-row`, `h-tree-row`, `h-session-row`, `size-harness-tile`, `px-row-x`, `gap-gap`, `p-panel`, `gap-section` read the active density's values (rule/density-through-tokens).
- **Radii** `rounded-control|row|card|full`; **shadow** `shadow-float`; `tabular` and `pixelated` utilities.
- shadcn's semantic variables (`--background`, `--primary`, `--muted`, `--border`, `--ring`…) map onto these, so a stock shadcn component picks up Night watch.
- **Midnight** (`data-theme="midnight"`, DESIGN.md's Mobile App) is dark with a black ground, `#0a0b0d` / `#141518` surfaces and an 8% hairline; it uses dark's images and signal colours.
- **`@polaris/ui/tokens`** is midnight and the Mobile App's type scale (Paper H4) as plain TS constants, with no DOM, React or Tailwind (its own `tsconfig.json` has no DOM lib). `src/tokens/midnight.test.ts` fails if they drift from `tokens.css` and theme.css's midnight block, or the block from DESIGN.md.
- Washes, scenes and halos come from `design/assets` through per-theme variables in `assets.css` (images can't be `light-dark()` pairs).

`cn()` is tailwind-merge taught the Polaris scale; without that, `text-caption text-text-subtle` would lose the size.

## Components

Restyled shadcn (`src/components/ui`): Button (`primary`, `secondary`, `ghost`, `danger`), Tooltip, HoverCard, Popover, DropdownMenu, ContextMenu, Command (cmdk; `CommandDialog` is the K jump menu), Dialog (never for Connection State), Input, Textarea, Switch, Select, ScrollArea, Separator.

Polaris (`src/components/polaris`): IconButton, Kbd, Badge, Row (list, session and tree rows), SectionHeader, Tile, StateIcon, HarnessMark, SeverityBadge and SeverityGlyph, GitStatusLetter, SegmentedControl, Chip (workspace, source, add), Toast with `Toaster` and `showToast`, CodeWell, Scene and Clearing, Dither, Composer with HarnessPicker and WorkingStrip, ApprovalCard (the Needs You hover card), EmptyState (the pane tier), Wordmark.

M1 coverage (V0): HostStateChip and HostStateCard (Connection State in the workspace bar and the inline Needs Attention card, Paper 5PM-1), HarnessChoice (the new-session cards, VG-0), NeedsYouCard, WaitingCard and QuestionCard (the inbox, 1G2-0), MachineBar (MX-0), and StageHeading, SetupCard/SetupRow, InstallWell/InstallCard (first run and install, 57Q-1 and 5FB-1).

- **Harnesses are catalogue-driven.** Every Harness-specific component takes any `HarnessKind` and reads its name, handle (`@claude`), hue and setup from `harnessHue()`, which looks the kind up in `@polaris/protocol`'s catalogue. The token slug comes from the name (Claude Code → `claude-code`, OpenCode → `opencode`), so adding a Harness to the catalogue needs no change here, only its `--color-harness-*` token, wash and halo (a test checks every catalogue entry has them; OpenCode's are already in). A kind the build doesn't know renders neutral, named by its kind. `HarnessChoice` takes the Host's availability: a Harness that isn't installed shows the catalogue's setup line and a link to its docs, never an install action.
- **StateIcon** follows DESIGN.md's state table exactly (`STATE_GLYPHS`), and takes the protocol's `SessionState` and `HarnessKind`. Only Working moves.
- **SeverityBadge** is always a labelled, shaped badge; states are unlabelled glyphs. The two never share a form (tested).
- **Dither** ports `design/scripts/gen_dither.py` (Bayer 4x4 over a moving wave, 2px cells): 12 frames baked into one SVG mask strip, stepped with `transform` at 83ms a frame, so it runs on the compositor. It fades in over 200ms and, in StateIcon, out over 200ms on leaving Working (`useExitPresence` does the same for any consumer); Reduce Motion stills it to frame 0 and makes both fades instant. Frame 0 matches `design/assets/dither/dither-claude-16.svg` cell for cell (tested).
- **Row** and **Chip** take `asChild` to render as a button or link: the child must be a single element, and the row's content goes inside it before the child's own children.
- **Halos** exist for every identity hue in both themes (`haloVar()`, generated by `design/scripts/gen_textures.py`).
- **rule/faint-is-not-content**: `text-faint` colours only placeholders, disabled text and ignored files (tested by scanning the sources); ages, empty lines, key hints and line numbers are `text-subtle`.
- **rule/signal-text-variants**: a signal hue set as words uses its `-text` token (`text-needs-you-text`, `text-failed-text`, `text-severity-*-text`, `text-diff-*-text`, `text-git-modified-text`, `harnessTextVar()`); glyphs, washes, dither, rules and line fills keep the base hue. Badges fill with `bg-*-fill` (the base hue at 12% dark, 10% light).
- **Brand moments**: `<Button variant="primary" size="brand">Get started <ButtonKeycap>↵</ButtonKeycap></Button>` (36px, 8px radius, the one button shadow), `Wordmark moment` and `StageHeading` carry the onboarding tracking. Onboarding only.
- **Icons**: `src/icons/chrome.tsx` re-exports 21 Nucleo UI outline icons (drawn at 16px with a 1px stroke); `src/icons/pixel.tsx` re-exports 9 Nucleo pixel icons for Polaris concepts plus the Polaris star (`star_cells()` from gen_dither.py). The Nucleo icons live in `src/icons/nucleo/` under the **Nucleo License, not Apache-2.0** (see its `LICENSE.md` and the root `NOTICE`); regenerate them with `scripts/vendor-nucleo.ts` from a licensed install. Nucleo allows at most 100 in an open-source project.

## Instrument cards and popovers

Every rich popover (model picker, session context, Stats, usage, constellation preview, Hosts) is an **instrument card** (DESIGN.md, Menus and popovers; Paper X-F). The API is stable:

```tsx
import { InstrumentCard, InstrumentPopoverContent, Kicker } from "@polaris/ui";

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>…</PopoverTrigger>
  <InstrumentPopoverContent
    align="end"
    header={{ mark: <ConstellationMark />, title: "Polaris planning", state: "6 workers", control: <SegmentedControl … /> }}
    hero={<Orrery />}          // optional; full width in its own well, capped at 160px
    heroMaxHeight={280}        // optional; raise the cap (the constellation glance), then it scrolls
    wells={[<Spend />, <Work />]} // one or two inset wells: hairline, 12px radius, bg-well
    footer={{ status: "As of 22:25 · revision 37", action: <Button>Compact now</Button> }}
  />
</Popover>;
```

- `header`: `title`, optional `mark`, optional mono `state` word, at most one `control`.
- `footer`: a mono `status` line (set as a Kicker) and at most one `action`.
- Both forms set `data-surface="raised"` on their root, so `bg-well` resolves one step off the raised surface (Moonlit #1A1B1D; on panels #222327; Midnight #0E0F12 in both).
- `InstrumentCard` takes the same slots for a card in place (Settings' usage); default width 400px, override with `className`.
- `Kicker`: mono caps, `text-subtle`, `parts` joined with " · " (`<Kicker parts={["Sessions", 4]} />` → SESSIONS · 4). Data labels only; `KICKER` is the class string.

**rule/popover-fits-window.** `PopoverContent` (and so every instrument card) is never taller than the room its trigger leaves (`--radix-popover-content-available-height`), stays 12px clear of the window (`collisionPadding`), and flips or shifts to the roomier side. An instrument card keeps its header and footer fixed and scrolls only the body, so its last row is always reachable; a plain popover scrolls as a whole. Dropdown and context menus are capped the same way. Check long popovers at 1280×720.

**Plain menus** (DropdownMenu, ContextMenu, Select, `menu-entries`): the raised surface, 14px radius, hairline, float shadow, 6px rows inset 4px with a `fill-selected` pill, mono kicker group headers (`MENU_LABEL`), key hints in `text-subtle`, no leading icons.

## Gallery

```sh
bun run --cwd packages/ui gallery        # http://localhost:5199
```

One page with every component and state, dark, midnight (with the mobile type scale) and light side by side, and "Artboard 5", the chrome of Paper's `11U-0` rebuilt statically from these components. Query parameters make each state reachable for screenshots: `?page=components|orchestrate`, `?density=calm|balanced|compact`, `?theme=dark|midnight|light`, `?reduce=1`, `?chrome=0` (no gallery header), and on the artboard page `?hover=1` (artboard 1's approval card), `?k=1` (artboard 3's jump menu), `?toast=0`.

## Tests

`bun test` (happy-dom): the state→glyph table and its coverage of the protocol's states, that only Working moves, Severity vs State forms, low-confidence dimming (never Critical), every DESIGN.md `-dark`/`-light` pair as one `light-dark()` token, the theme selectors, the dither port against the committed asset, and `cn()`'s merging.
