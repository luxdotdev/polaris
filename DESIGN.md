---
name: Polaris
description: Quiet chrome, rare signals, and a pixel night sky for when agents are alive.
colors:
  # Neutrals, dark (default theme). Faintly cool.
  bg-dark: "#1A1B1D"
  surface-sunken-dark: "#151618"
  surface-raised-dark: "#222327"
  fill-selected-dark: "#2B2C31"
  fill-hover-dark: "#242529"
  row-selected-dark: "#26272C"   # the selected session row: a raised card
  hairline-dark: "#FFFFFF0F"
  text-strong-dark: "#F4F5F7"
  text-default-dark: "#E3E4E8"
  text-subtle-dark: "#9A9CA4"
  text-faint-dark: "#686A72"     # placeholders and disabled text only (rule/faint-is-not-content)
  # Neutrals, light.
  bg-light: "#FBFBFC"
  surface-sunken-light: "#F3F3F5"
  surface-raised-light: "#FFFFFF"
  fill-selected-light: "#EDEDEF"
  fill-hover-light: "#F4F4F6"
  row-selected-light: "#FFFFFF"  # a white card on the sunken sidebar (see Session rows)
  hairline-light: "#0000000F"
  text-strong-light: "#17181A"
  text-default-light: "#333438"
  text-subtle-light: "#66686F"   # 5.0:1 on surface-sunken, 4.8:1 on fill-selected
  text-faint-light: "#A4A6AC"
  # Brand: starlight. Focus rings, Polaris's own activity, logo, the star. Nothing else.
  starlight-dark: "#BCD3FF"
  starlight-light: "#4F82E8"
  # Session State signals.
  needs-you-dark: "#F2C84B"
  needs-you-light: "#B98A00"
  failed-dark: "#F0645A"
  failed-light: "#D23B30"
  # Text variants: signal hues set as words (labels, second lines, badge text, the danger button).
  # Glyphs, washes, dither and line fills keep the base hues above. See rule/signal-text-variants.
  needs-you-text-dark: "#F2C84B"
  needs-you-text-light: "#856300"
  failed-text-dark: "#F37B72"
  failed-text-light: "#BF3228"
  # Severity.
  # Severity. Always a filled badge: shape + label + colour.
  severity-critical: "#E5484D"   # red, diamond
  severity-high-dark: "#F2894A"   # orange, triangle
  severity-high-light: "#C85A12"
  severity-medium-dark: "#E6C04A" # yellow, filled circle
  severity-medium-light: "#9C7A06"
  severity-low-dark: "#8A93A6"    # slate, hollow circle
  severity-low-light: "#626B7D"
  # Severity text variants: badge labels and glyphs set in text. Badge fill is the base hue at 12% (dark) / 10% (light).
  severity-critical-text-dark: "#F2787C"
  severity-critical-text-light: "#BE2C36"
  severity-high-text-dark: "#F2894A"
  severity-high-text-light: "#A6490C"
  severity-medium-text-dark: "#E6C04A"
  severity-medium-text-light: "#7A5E00"
  severity-low-text-dark: "#9AA2B3"
  severity-low-text-light: "#5A6273"
  # Harness identity hues (provisional).
  harness-claude-code: "#D97757"
  harness-claude-code-light: "#C4562F"
  harness-codex: "#6FCBA0"
  harness-codex-light: "#1E8A5C"
  harness-opencode: "#E58FA8"   # provisional, rose
  harness-opencode-light: "#B8466A"
  # Harness text in light mode (Working strip, picker chip, the Editor's agent flag); dark text uses the hue itself.
  harness-claude-code-text-light: "#AC4824"
  harness-codex-text-light: "#167550"
  # Diffs. Applied as low-opacity line fills; word-level highlights use ~2x opacity.
  diff-added: "#3FB950"
  diff-removed: "#F85149"
  diff-added-cvd: "#388BFD"
  diff-removed-cvd: "#DB8B2C"
  # Pierre Diffs line fills (see Diff section for the variable map)
  diff-added-bg-dark: "#3FB9501A"
  diff-removed-bg-dark: "#F851491A"
  diff-added-emphasis-dark: "#3FB95040"
  diff-removed-emphasis-dark: "#F8514940"
  diff-added-bg-light: "#1A7F3714"
  diff-removed-bg-light: "#CF222E12"
  diff-selection-dark: "#BCD3FF29"
  diff-selection-light: "#4F82E829"
  # Git status (Editor file tree, tabs, gutter). Added/untracked use diff-added, deleted uses diff-removed.
  git-modified-dark: "#D6B37E"
  git-modified-light: "#9A6B16"
  # Diff and git text: +/− counts, status letters and tinted file names. Line fills keep diff-added / diff-removed.
  diff-added-text-dark: "#57C46A"
  diff-removed-text-dark: "#F07A7E"
  diff-added-text-light: "#1A7F37"
  diff-removed-text-light: "#CF222E"
  git-modified-text-light: "#8A5F12"
  # Syntax: "moonlit". Low chroma so signals still stand out over code.
  syntax-keyword-dark: "#A3AFCB"
  syntax-string-dark: "#D9C9A3"   # strings and numbers
  syntax-type-dark: "#A9C6BD"     # types, components, classes
  syntax-function-dark: "#F4F5F7" # called and declared functions
  syntax-comment-dark: "#6E7280"
  syntax-punctuation-dark: "#9A9CA4"
  syntax-keyword-light: "#4A5A80"
  syntax-string-light: "#86652E"
  syntax-type-light: "#3E6B5E"
  syntax-function-light: "#17181A"
  syntax-comment-light: "#A4A6AC"
  syntax-punctuation-light: "#74767D"
typography:
  display:
    fontFamily: "SF Pro"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "30px"
    letterSpacing: "normal"
  title:
    fontFamily: "SF Pro"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "24px"
    letterSpacing: "normal"
  heading:
    fontFamily: "SF Pro"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  heading-sm:
    fontFamily: "SF Pro"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  body:
    fontFamily: "SF Pro"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "normal"
  label:
    fontFamily: "SF Pro"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "normal"
  caption:
    fontFamily: "SF Pro"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "normal"
  code:
    fontFamily: "SF Mono"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "normal"
  code-inline:
    fontFamily: "SF Mono"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "normal"
rounded:
  control: "6px"
  row: "10px"
  card: "14px"
  full: "999px"
spacing:
  # Density: Calm (default)
  calm-row: "32px"
  calm-tree-row: "28px"
  calm-row-pad-x: "10px"
  calm-gap: "8px"
  calm-panel-pad: "16px"
  calm-section-gap: "24px"
  # Density: Balanced
  balanced-row: "28px"
  balanced-tree-row: "24px"
  balanced-row-pad-x: "8px"
  balanced-gap: "6px"
  balanced-panel-pad: "12px"
  balanced-section-gap: "16px"
  # Density: Compact
  compact-row: "24px"
  compact-tree-row: "22px"
  compact-row-pad-x: "6px"
  compact-gap: "4px"
  compact-panel-pad: "10px"
  compact-section-gap: "12px"
components:
  button-primary-dark:
    backgroundColor: "{colors.text-strong-dark}"
    textColor: "{colors.bg-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-primary-light:
    backgroundColor: "{colors.text-strong-light}"
    textColor: "{colors.surface-raised-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-secondary-dark:
    backgroundColor: "{colors.fill-selected-dark}"
    textColor: "{colors.text-default-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-secondary-light:
    backgroundColor: "{colors.fill-selected-light}"
    textColor: "{colors.text-default-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-danger-dark:
    backgroundColor: "{colors.fill-selected-dark}"
    textColor: "{colors.failed-text-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-danger-light:
    backgroundColor: "{colors.fill-selected-light}"
    textColor: "{colors.failed-text-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 12px"
  button-brand-moment-dark:
    backgroundColor: "{colors.text-strong-dark}"
    textColor: "{colors.text-strong-light}"
    typography: "{typography.label}"
    rounded: "8px"
    height: "36px"
    padding: "0 14px 0 18px"
    shadow: "0 8px 24px #00000059"
  button-brand-moment-light:
    backgroundColor: "{colors.text-strong-light}"
    textColor: "{colors.surface-raised-light}"
    typography: "{typography.label}"
    rounded: "8px"
    height: "36px"
    padding: "0 14px 0 18px"
    shadow: "0 8px 24px #0000001F"
  row-selected-dark:
    backgroundColor: "{colors.fill-selected-dark}"
    textColor: "{colors.text-strong-dark}"
    rounded: "{rounded.row}"
  row-selected-light:
    backgroundColor: "{colors.fill-selected-light}"
    textColor: "{colors.text-strong-light}"
    rounded: "{rounded.row}"
  badge:
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    height: "20px"
    padding: "0 6px"
  tile:
    rounded: "{rounded.row}"
    size: "32px"
  toast:
    rounded: "{rounded.card}"
    width: "360px"
---

# Design System: Polaris

Scope: the Desktop App (macOS). The Mobile App gets its own section when it is designed. Product truth, users, and voice live in `PRODUCT.md`; domain vocabulary lives in `CONTEXT.md`. This file never redefines either.

## Overview

**North star: "Night watch."** Polaris is the window a developer keeps open for hours while several agents work. The chrome is quiet, nearly colourless, and flat, so the code and the agents' work stay in front. Two things break the quiet, and only when they mean something:

1. **Signals.** Colour appears only for Session State, Severity, diffs, and Harness identity. Motion appears only while an Agent Session is Working.
2. **The pixel world.** Pixel icons on watercolour-washed tiles, dither that shimmers in a Harness's hue while it works, and full pixel scenes (a night sky with Polaris in dark mode, a meadow at dawn in light mode) in onboarding and empty states.

Dark is the default theme; light is equally supported. Every token exists in both, and neither is an afterthought.

The Desktop App is Electron (Chromium 152, React). CSS effects are available: shadows, rounded clipping, per-element `backdrop-filter`, springs, custom fonts, and window-level vibrancy. The budgets still rule: display-rate frames (180 Hz measured) and under 1 GB for the whole app. See **Performance** under Motion.

**Assets and source files.** Generated textures live in `design/assets/` (dither frames, state icons, scenes, watercolour washes, halos) and are reproducible from `design/scripts/gen_dither.py` and `design/scripts/gen_textures.py`. Mockups: the Paper file "Polaris — Orchestrator" (https://app.paper.design/file/01M3JV1J857QNW61TGHZYR6GMZ); artboard 5, "Orchestrate · Elevated", is the chosen Orchestrator direction, artboard 7 shows a constellation with a subagent in focus, the Review page holds R1 (pull request, dark) and R2 (agent session turns, light), and the Editor page holds E1 (editor, dark), E2a (selection, dark), E2 (inline chat, dark) and E3 (an agent editing your file, light). The file's Paper tokens mirror this frontmatter as `-dark`/`-light` pairs.

**Mode:** Operate. Scanability, consistency, and native macOS expectations outrank expression. Brand lives in precise details and the pixel world.

### Brand

- **Wordmark:** "Polaris" in Geist Pixel, style Square (from the `geist` package, SIL OFL), title case. It appears only where Polaris names itself: the title bar (13px, after the traffic lights, beside the 16px star), About, onboarding, and app icon lockups. Never in working UI copy.
- **Mark:** a symmetric 16×16 pixel star: a 2px spine, rays that step out evenly (2, 4, 6, 8, 16 pixels wide), and short diagonal rays, in the spirit of Minecraft's Nether star. At 24px and up it is shaded in three tones (outline, body, white core): `design/assets/brand/polaris-logo-*.svg`. Below 24px it is flat: `design/assets/icons/px-polaris-*.svg`. Both are generated by `gen_dither.py`. Colourways: Starlight on dark, blue on white, ink or white for one-colour use. Smallest size is 16px; the title bar pairs it with the 13px wordmark.
- **Idea and tagline:** Polaris is the fixed point your agents steer by. Tagline: "The north star for your agents." Principles: calm, precise, alive.
- **Lockups:** horizontal (default), stacked, and mark only. Clear space on every side equals a quarter of the mark. The star always leads the wordmark.
- **App icon:** the night-sky scene cropped around Polaris, in the macOS squircle, with the shaded Starlight mark centred. At 32px and below the sky flattens to Night and the star goes flat. The menu bar item is the flat white star plus the needs-you count.
- **Brand colours:** Night `#0A0D1A` (brand ground), Charcoal `#1A1B1D` (product dark), Starlight `#BCD3FF` (the only brand hue), Starlight deep `#4F82E8` (on light), Snow `#F4F5F7`, Ink `#17181A`, and Lamplight `#F2C27A` (the cabin window, rare). Roughly 60 / 22 / 9 / 6 / 2 / 1. Signal colours never appear in marketing.
- **Brand type:** Geist Pixel is the wordmark only. Headlines and body in brand materials are SF Pro (medium and regular); code and data are SF Mono.
- **The twinkle:** on launch only, the star's core brightens for two frames. The mark never animates anywhere else.
- **Brand deck:** the "Brand deck" page of the Paper file (12 slides: cover, idea, principles, voice, mark, logo, app icon, colour, typography, pixel world, icons and motion, applications).
- Draw the mark on whole pixels only; never rotate, outline, or anti-alias it.
- **Marketing site:** the "Marketing site" page of the Paper file (S1, desktop, dark, a draft). It uses the brand deck's system: Night ground, the night-sky scene in the hero and the closing CTA only, SF Pro Regular headlines with tight tracking, mono section kickers (`01 — Supervise`), and real product shots exported from accepted artboards (`design/assets/site/`), never redrawn UI. One primary action on every screen, "Download for macOS", as a Snow button; the secondary action is always the source. Starlight stays off buttons and links here too (rule/starlight-is-rare), and signal colours appear only inside product shots. Until the repo is public, every source link reads "Source opens soon" and leads to a one-email notify form. Copy names what Polaris does, not the hardware it runs on: hosts are "this Mac" or "any machine you can reach over SSH". The footer credits lux.dev LLC ("An open source project by lux.dev", "© 2026 lux.dev LLC"). rule/scene-text-contrast holds on the site too: the nav sits on a solid Night bar (~95%) with links in `#C9D0E0`, never directly on the sky, and buttons over a scene are opaque. S2 is the light version: the dawn scene in the hero (faded into `bg-light` above the product shot) and the closing CTA, light product shots, ink primary buttons, the blue colourway of the mark, and light dither and wash variants. S3 is mobile (390, dark): one column, shots bleed off the right edge, and because a phone cannot install a Mac app the primary action becomes "Email me the Mac download" (email field plus button) instead of Download.

## Colors

### Primary

**Starlight** (`starlight-dark` #BCD3FF, `starlight-light` #4F82E8) is the brand: a cool white-blue. It appears in exactly four places: keyboard focus rings, the activity indicator and dither for Polaris's own work (such as the Risk Summary reviewer), the logo mark, and the star in the night-sky scene.

### Neutral

Faintly cool greys (a trace of blue, never readable as blue). Dark background is a soft charcoal (#1A1B1D), never pure black; light background is off-white (#FBFBFC).

- Hierarchy comes from **text colour**, not weight: `text-strong` for titles and selected items, `text-default` for content, `text-subtle` for secondary labels, section headers, metadata, ages, second lines and key hints, `text-faint` for placeholders and disabled text only.
- **rule/faint-is-not-content:** `text-faint` is for placeholders, disabled controls, ignored files and ghost text, never for text the user must read. It is below 4.5:1 in both themes by design; anything informative (ages, counts, empty-state lines, line numbers, key hints) is at least `text-subtle`, which clears 4.5:1 on every surface in both themes.
- Layers are tonal: `surface-sunken` for sidebars and wells, `bg` for the main canvas, `surface-raised` for popovers and toasts.
- Selection is a soft grey fill (`fill-selected`), never an accent colour.
- Borders are 1px `hairline` (white or black at ~6%).

### Signal colours

| Signal | Colour | Where |
|---|---|---|
| Needs You | `needs-you` (yellow) | The only attention colour for Session State. Also drives the Dock badge. |
| Failed | `failed` (red) | The state icon only, never the whole row. |
| Critical ◆ | `severity-critical` (red) | Review and Output. Secrets, security, data loss. Always visible; no Risk Memory hides it. |
| High ▲ | `severity-high` (orange) | Review and Output. |
| Medium ● | `severity-medium` (yellow) | Review and Output. |
| Low ○ | `severity-low` (slate) | Review and Output. |
| Diff added / removed | `diff-added`, `diff-removed` at ~12% line fill, ~25% word highlight; counts and letters in `diff-*-text` | Review and Editor. `-cvd` blue/orange set in settings. |

### Harness identity

Each Harness has one fixed hue; every Agent Session with that Harness uses it. Claude Code is `harness-claude-code` (coral orange; `-light` #C4562F). Codex is `harness-codex` (mint; `-light` #1E8A5C). Where the hue is text in light mode, it uses `harness-*-text-light` (rule/signal-text-variants). OpenCode is `harness-opencode` (rose, provisional; wash and dither generated by `gen_textures.py` and `gen_dither.py`). These are provisional until checked against the signal colours in real screens. Harness hue appears in the dither, the session's Harness tile, and toasts that Harness sent. It may also colour text and borders in exactly three places: the Working strip (in the composer, and across the top of an Editor file an agent is editing), the Harness picker chip, and an agent's live caret and lines in the Editor (see Components). It never appears on buttons, selection, or body text.

### Named Rules

- **rule/colour-means-something:** a colour on screen must be Starlight, a Session State signal, a Severity, a diff, a git status, a syntax token, or a Harness hue. Anything else is a neutral.
- **rule/syntax-is-moonlit:** syntax colours stay low-chroma and never reuse a signal hue, so a Severity, diff or Needs You mark is always the loudest thing over code.
- **rule/git-is-a-letter:** a git status is always its letter (M, A, U, D, R, C, !) in a fixed slot, with the file name tinted to match. It never uses a dot or icon alone, so modified tan never reads as Needs You yellow (which is always a pixel icon).
- **rule/starlight-is-rare:** Starlight never appears on buttons, links, selection, or hover.
- **rule/no-colour-alone:** every colour signal also has an icon, shape, or label.
- **rule/signal-text-variants:** a signal hue set as words (a label, a second line, badge text, a count, a git letter, the danger button) uses its `-text` variant, which clears 4.5:1 on `bg`, `surface-sunken`, `surface-raised` and its own badge fill in that theme. Glyphs, washes, dither, rules and line fills keep the base hue. Where a pair has no `-text` variant (needs-you, severity-medium and failed in dark; diff and git-modified in dark), the base value already clears 4.5:1 and is the text colour.
- **rule/severity-is-a-badge:** a Severity is always a filled badge with its shape (◆ ▲ ● ○), its label, and its colour. Never colour alone, never a bare dot.
- **rule/severity-vs-state:** Severity badges and Session State indicators never share a form. State uses 16px pixel icons and dots with no label; Severity uses labelled badges. This keeps Medium yellow apart from Needs You yellow and Critical red apart from Failed red.
- **rule/low-confidence-dims:** non-Critical Findings under 50% confidence render at reduced emphasis (text-subtle, badge at 60%). Critical is never dimmed.

## Typography

**SF Pro** for all UI; **SF Mono** for code (the Editor's font and size are user settings; SF Mono 13/20 is the default). Two weights only: Regular (400) for content, Medium (500) for labels, headings, and emphasis. No Semibold or Bold. Letter spacing stays at the system default, except on brand moments: the onboarding tagline and scene headlines (`display`) take −0.015em and the wordmark −0.01em, as in the Paper O1 artboards. Working UI never tightens.

### Hierarchy

| Role | Size / line | Weight | Use |
|---|---|---|---|
| display | 24/30 | Medium | The largest text anywhere: onboarding and empty-state headlines. |
| title | 18/24 | Medium | View titles, dialog titles. |
| heading | 16/20 | Medium | Panel titles, toast titles. |
| heading-sm | 14/20 | Medium | Section headings in content. |
| body | 13/18 | Regular | The base size. Messages, descriptions, list content. |
| label | 13/16 | Medium | Buttons, row titles, tabs. |
| caption | 12/16 | Regular | Metadata, timestamps, badges, sidebar section headers (in `text-subtle`, sentence case). |
| code | 13/20 | Regular (Mono) | Editor, diffs, Turn output. |
| code-inline | 12/16 | Regular (Mono) | Paths, branch names, commands in prose. |

Text size is an accessibility setting that scales this whole table; it is independent of density.

### Named Rules

- **rule/sentence-case:** all labels, buttons, and headers are sentence case. No all caps.
- **rule/glossary-lowercase:** glossary terms from `CONTEXT.md` are lowercase in product copy unless they start a sentence or label: "Save verdict", "Risk summary", "on a new worktree", "Needs you · turn 9", "4 hosts · 11 workspaces". Only true proper nouns keep capitals: Polaris, Harness products (Claude Code, Codex), machine names (Mac Studio), and PR or repo titles as their authors wrote them. `CONTEXT.md` capitalises its headwords as a document convention; that never carries into the UI.
- **rule/tabular-numbers:** counts, durations, and line numbers use tabular figures.

## Layout

One main window. The user moves between the Orchestrator, Review, and the Editor inside it; there are no secondary document windows.

### Density

A three-step slider in Settings (Discord-style) swaps the spacing token set. It changes spacing and row height only; text size is separate, and the Editor keeps its own line height.

| Step | Row | Tree row | Session row | Harness tile | Row padding | Gap | Panel padding | Section gap |
|---|---|---|---|---|---|---|---|---|
| **Calm** (default) | 32 | 28 | 48, two lines | 28 | 10 | 8 | 16 | 24 |
| Balanced | 28 | 24 | 40, two lines | 24 | 8 | 6 | 12 | 16 |
| Compact | 24 | 22 | 28, one line | 20 | 6 | 4 | 10 | 12 |

Session rows are the exception to the single-line row: they carry a second line saying what the session is doing, so they get their own height per step. Compact drops the second line.

Every screen must be checked at all three steps. Components read spacing only through the active density's tokens, never from literal values.

### Named Rules

- **rule/density-through-tokens:** no hard-coded row heights or paddings; use the active density's tokens.
- **rule/no-dashboard-clutter:** lists before cards. A view gets cards only when each card is an object the user acts on.

## Elevation & Depth

Flat. Depth comes from tonal layers (`surface-sunken` < `bg` < `surface-raised`) plus 1px hairlines. Only floating things cast a shadow.

### Blur and vibrancy

- **Window vibrancy** (native, behind content) is allowed for the title bar and sidebars only, and must look right with vibrancy off.
- **`backdrop-filter` blur** is allowed on floating layers: menus, popovers, the jump menu and its scrim, toasts. Keep the radius at or under 20px, never animate the blur radius, and never put a blurred layer over content that is scrolling or animating underneath.
- Working surfaces (lists, conversation, diff, Editor) are opaque.

### Shadow Vocabulary

- **float:** menus, popovers, command palette, toasts. A soft, low-contrast shadow (dark: y 8, blur 24, black 40%; light: y 8, blur 24, black 10%) plus a hairline.
- Nothing else gets a shadow: not cards, rows, tiles, or panels. The one exception is the brand-moment button (see Buttons).

## Shapes

| Token | Radius | Use |
|---|---|---|
| `control` | 6px | Buttons, inputs, badges, segmented controls. |
| `row` | 10px | Selected and hovered rows, tiles. |
| `card` | 14px | Cards, popovers, menus, toasts, dialogs. |
| `full` | 999px | Status dots and avatars only. |

The window uses the native macOS corner radius. Pixel icons and dither are drawn on a strict pixel grid (see Components) and never rounded or anti-aliased.

## Components

### Buttons

- **Primary:** monochrome fill (near-black in light mode, near-white in dark), `label` type, 28px tall, 6px radius. At most one per view.
- **Secondary:** `fill-selected` fill, `text-default`.
- **Ghost:** no fill until hover (`fill-hover`). Icon buttons are ghost buttons with a 16px icon in a 28px square.
- **Danger:** the secondary shape (`fill-selected`, 28px, 6px radius) with its label in `failed-text` (#F37B72 dark, 5.2:1 on `fill-selected`; #BF3228 light, 4.9:1). For destructive actions that name their object ("Remove host"); never a red fill, and never the view's primary.
- **Brand moment:** the primary button, larger, for onboarding and brand moments only (the welcome "Get started", the marketing site): 36px tall, 8px radius, 18px/14px padding, `label` type, a trailing 18px keycap (↵) at 4px radius, and the float shadow (dark black 35%, light black 12%). This is the one place a button casts a shadow. Working UI always uses the 28px primary.
- Focus is always a 2px Starlight ring with a 2px offset.

### Rows and lists

The main unit of the app. A row is an optional 16px icon or tile, a `label` title, and optional `caption` metadata on the right. Hover gives `fill-hover`, selection gives `fill-selected`, both at the `row` radius, inset from the panel edge by the panel padding. Sidebar section headers are `caption` in `text-subtle`, with no dividers.

### Session rows

The Orchestrator's sidebar unit, and the Harness's home in the chrome. A session row is a Harness tile (size per density step), a `label` title, a `caption` second line saying what the session is doing right now ("Wants to run cargo build", "Writing layout variants…", "Ready to review · 3 files"), and a trailing age. The Session State lives *inside* the tile, so one square carries both who (the wash) and what (the glyph). Needs You tints the second line `needs-you-text`; other second lines and the age are `text-subtle`. The selected row is a raised card (`row-selected`): `#26272C` dark, white in light, hairline border, `row` radius. Light chose white over `fill-selected` because text on it keeps more contrast (`text-subtle` 5.6:1 vs 4.8:1, `needs-you-text` 5.6:1 vs 4.8:1) and it separates more from the sunken sidebar. Dormant tiles drop the wash and use a dashed hairline.

### Session State indicators

Each Agent Session shows its state as a glyph inside its Harness tile (session rows) or in a fixed 16px slot (chips, menus, compact lists):

| State | Indicator | Moves? |
|---|---|---|
| Starting | Still pixel pattern in the Harness hue at 50% | No |
| **Working** | Dither in the Harness hue | **Yes (the only looping motion)** |
| **Needs You** | Pixel "needs you" icon in `needs-you`; the row title goes to `text-strong` | No |
| Idle | Solid dot in `text-subtle` | No |
| In Terminal | Pixel terminal icon in `text-subtle` | No |
| Dormant | Hollow dot in `text-faint` | No |
| Failed | Pixel "failed" icon in `failed` | No |
| Archived | Hidden from active lists; shown in `text-subtle` where listed | No |

- **rule/only-working-moves:** nothing loops except the Working dither.
- **rule/needs-you-is-loudest:** Needs You is the only Session State with an attention colour, and it sorts to the top.

### Risk Findings

A Finding row carries a Severity badge in a fixed-width slot, then the reason, then the confidence. The badge is 20px tall, 6px radius, a soft tint of the Severity colour with the shape glyph and label in the full colour: ◆ Critical (red), ▲ High (orange), ● Medium (yellow), ○ Low (slate). A Risk Summary ranks by Severity, then confidence; non-Critical Findings under 50% confidence are dimmed. In Output's Changes tab, the same badge sits in the file header and on the flagged line's gutter.

### Review

The Review view mirrors the Orchestrator's three zones: **queue** (left), **risk column** (360px), **diff** (the largest pane). The same layout serves a pull request and an agent session's turns.

- **Queue.** Groups in this order: Review requested, Agent sessions ready, Mine, Other open, then "Review a PR by URL" in the footer. PR rows are two-line session-style rows with a neutral PR tile; agent sessions use their Harness tile. Each row ends with its highest Severity glyph and count ("▲ 1", "◆ 1").
- **Subject header.** Title plus number, then one caption line (author, base and head branches as mono chips, repo). On the right: the review checkout chip ("Checked out on Linux VM · at 4f2c1a · Run") and the one primary action. For a PR it is "Submit review" with the pending-comment count; for an agent session it is a split button "Accept and open PR", preceded by a turn picker (22 · 23 · 24 · All).
- **The reviewer is Polaris.** The risk summary is Polaris's own work, so it carries the Starlight identity: a Starlight-washed tile with the pixel north-star mark (`design/assets/icons/px-polaris-*.svg`). The same mark prefixes "Ask the reviewer" and reviewer-authored proposals.
- **Risk column.** Header, then a four-cell Severity tally (◆ ▲ ● ○ with counts; zero cells go faint), then findings ranked by Severity then confidence. The selected finding expands into a card with a hanging indent: badge on the left, title, reason and `file:line · source · confidence` aligned on the title's edge, and the verdict buttons (thumbs up/down) trailing. Below the findings: files with Viewed checkboxes, a progress bar ("3 of 7 viewed") and each file's highest Severity glyph. "Ask the reviewer" sits at the bottom as a composer.
- **Diff.** File cards with the Severity badge and a Viewed checkbox in the header, a hunk header in faint mono, and the flagged line marked twice: the Severity glyph in the gutter and a 2px inset rule in the Severity colour. Pending comments render inline under their line as raised cards labelled "Pending · Goes out with your review", linked to the finding they answer. Agent-session diffs group by turn, with a divider that quotes the turn's prompt; reviewed turns collapse to one line with a check.
- **Verdict popover.** Opens from thumbs-down beside the finding: "Why is this not a problem?", reason pills (Already handled, Intended, Wrong line, Too noisy, Other…), an optional note, a scope segmented control (This change / This repo / Everywhere), and a footer with the Polaris mark, "Rule changes wait for you", and "Save verdict".
- **Critical findings pause acceptance.** While any critical finding is open, the accept action shows as a disabled button reading "Accept paused · 1 critical", and the critical card says so in plain words. Nothing hides or dims a critical finding.
- **Feedback for the next turn.** On an agent session, comments batch into a sunken card "Feedback for turn N" that quotes the lines and sends with a Harness-picker-style chip ("Send to @claude").
- **Risk memory proposals.** When verdicts suggest a rule, the reviewer proposes it in a Starlight-bordered card at the foot of the risk column: the rule in plain words, "from N verdicts", and Approve / Keep private / Not now. The reviewer never changes its own rules without this approval.

### Badges

20px tall, 6px radius, `caption` type, a soft fill of the base hue at 12% (dark) / 10% (light) with the label in the hue's `-text` variant (like "New" or "Connected"). Every label clears 4.5:1 on its fill. Used for counts, Severity, and short status words; never for decoration.

### Pixel tiles

A square tile holding a Nucleo pixel icon over a watercolour wash. Sizes are 24, 32 (default), and 40px, at the `row` radius, with a 1px hairline. The wash is a soft, slightly grainy tint of the identity hue (a Harness hue, or Starlight for Polaris). Tiles represent identities and Polaris-owned concepts: Harnesses, Agent Sessions, toast sources. They are never used as generic decoration on list rows.

### Toasts

Top-right, 360px wide, `card` radius, `surface-raised` with a float shadow. Leading edge: a pixel tile, full toast height, washed in the **source's** hue (the Harness that sent it, or Starlight for Polaris). Title in `heading`, one line of `body` in `text-subtle`, at most one action. Whether the news is good or bad is carried by the pixel icon and the words, never by the wash.

### Harness picker

A chip in every composer: a small Harness tile, `@claude` or `@codex` in `label` type, the model in `caption`, and a chevron. It may take the Harness hue on its text and a 30% Harness-hue border while that Harness is Working. On the new-session page it expands into the Harness choice (see New session).

### Working strip

While a Turn runs, the composer grows a 34px strip across its top: a dither glyph, "Claude Code is working" in the Harness hue, elapsed time in `text-subtle`, and a Stop control (esc) on the right. A dither halo in the Harness hue bleeds from the strip's top-left corner. The composer's border takes the Harness hue at ~28% with a 3px outer ring at ~6%. The placeholder becomes "Queue a follow-up for after this Turn". This strip is the loudest thing on a Working screen and replaces any spinner.

### Sources

The selected session's Sources show as chips, not rows: a brand mark tinted by its own brand (Linear indigo, GitHub neutral) plus the identifier, files in `code-inline`, and a dashed "+ Add" chip. Brand colour here is the brand's, not Polaris's, and stays at chip scale.

### Turns in the conversation

Earlier Turns collapse to a one-line card (Turn number, summary, +/−, chevron). The live Turn shows the Harness tile as its avatar, a "Thought for Ns" disclosure, a stacked sources pill, the prose, and a step checklist in a `row`-radius well: done steps get a check in `text-subtle`, the current step gets the dither and a faint Harness-hue fill, and pending steps get a hollow dot in `text-faint`.

### Dither halo

The only way Polaris adds glow or emphasis: an ordered-dither radial field in a single hue (Starlight or a Harness hue), drawn as pixels at ~35% alpha. Glow is always a dither halo, never a blur or a soft coloured shadow, because the pixel field is the brand. Used behind the working strip corner and around Polaris in scenes. Never behind text that must be read.

### Dither

The signature component: a field of square cells lit on a strict pixel grid.

- **Geometry:** cells are 2pt squares on a fixed grid, lit by an ordered (Bayer 4x4) threshold pattern. No blur, no anti-aliasing, no gradients.
- **Timing:** a new frame every ~83ms (12 fps), so it reads as pixel animation, not video. It fades in over 200ms on entering Working and fades out over 200ms on leaving it.
- **Colour:** the Harness hue, or Starlight for Polaris's own work.
- **Implementation:** frames of lit cells baked into a horizontal sprite strip, stepped by translating the strip (`transform`) inside a clipped box, so the animation stays on the compositor. Canvas is acceptable for large fields such as scenes.
- **Where:** the Working indicator, the composer while a Turn is being sent, mode or Harness activation moments, and 12px marks in the Editor's file tree and tabs on files a Working agent is changing. Never in the Editor's text area or behind diffs.
- **Reduce Motion:** replaced by a still pixel pattern.

### Pixel scenes

Full-bleed pixel illustrations: a night sky with Polaris for dark mode, a meadow at dawn for light mode. Only in onboarding, first run, and empty states (including the new-session page), never behind working surfaces (Orchestrator lists, Review, the Editor). Content over a scene sits on a `surface-raised` card. The current scenes are generated by `design/scripts/gen_textures.py`; do not copy the inspiration images. Both scenes carry the same cabin, seated on the ground line: moonlit with a lit window at night, warm timber with the lamp still on at dawn.

- **rule/scene-text-contrast:** any text set directly on a scene sits on a "clearing": a solid radial vignette of the scene's darkest colour (dark: `#070912` at ~90% in the centre, fading to 0) sized to the text block plus 80px, and secondary lines use `text-default`, not `text-subtle`. Every line must clear 4.5:1 against the worst pixel behind it, stars included.

### New session

The empty-state page for starting an Agent Session. Night-sky scene (dawn in light mode) fills the stage; the sidebar stays. A clearing holds a Starlight kicker ("New session · polaris"), the `display` headline "What should happen next?", and one line saying where it runs (Host, path, Worktree). Below it, the composer on a `surface-raised` card. Below that, the Harness choice as **one balanced row of three equal cards spanning the composer's width**: Claude Code, Codex, Fork a Turn. Each is 56px tall with a 48px watercolour tile on its leading edge, a 14px title and a one-line `caption`; the selected card gets `text-strong`, a brighter hairline and a check. No staggering or cascade.

### Settings
Settings replaces the three zones inside the one main window (no separate window); ⌘, opens it and esc returns. Mockups: Settings page, S1 Harnesses (dark), S2 Usage (dark), S3 Appearance (light), S4 Hosts (dark).
- **Layout.** A 264px `surface-sunken` nav ("Back to orchestrate" with an esc keycap, the `title` "Settings", sections General / Agents / Machines, About Polaris with the flat mark and version at the foot) and one centred 680px column on `bg`. The page title is `title`, never `display`; one `body` line in `text-subtle` says what the page controls.
- **Groups, not cards.** Settings sit in hairline-bordered groups at the `card` radius with hairline row dividers; a sunken footer strip holds secondary defaults. Rows keep fixed lanes (name, version or value, state, trailing action) so columns align across rows.
- **Harnesses (S1).** One group per Harness: a 40px Harness tile with its still dither, name, one caption line on how Polaris drives it, and "Ready on N of M hosts". One row per host: version (mono), availability (ready with its sign-in kind, needs sign-in, needs a newer version, not installed) in neutral glyphs and text, never a signal colour, and at most one action ("Sign in in terminal", "Copy install command", "Copy update command"). Sign-in always opens the Harness's own terminal; Polaris never shows a key field (ADR 0001). The footer strip sets what new sessions start with: model, effort, permissions. A Harness that is ready everywhere collapses to its header.
- **Usage (S2).** Plan limits first: one row per Harness with the plan, freshness ("live" or "as of 40m ago") and each window as a pixel-cell meter (40 cells, 4×10px, lit cells in the Harness hue, unlit at white 7%) with the percentage and the reset time. Near a limit the words change, never the colour. Then tokens: a 7 / 30 / 90 days segmented control, a "Split by Polaris sessions" switch, three `display` figures (tokens, API-equivalent cost marked estimated, share in Polaris sessions), a stacked daily bar chart in Harness hues with usage outside Polaris at ~32% of the hue, and a by-model table where estimated costs carry a leading "~" and Harness-reported costs do not.
- **Appearance (S3).** Theme is three cards previewed with the real scenes: Night (dark), Dawn (light) and Match macOS (split). The density slider has three stops and a live session-row preview beside it; text size is its own slider; code font, colourblind-safe diffs (with a +/− swatch) and Reduce motion follow as rows.
- **Hosts (S4).** A table of hosts (name, ssh alias in mono, workspace count, daemon version, Connection State, overflow menu). Connected is a filled `text-subtle` dot with latency; Reconnecting dims the row to ~55% with a hollow dot and elapsed time; Offline is a dashed dot with "last seen"; Needs Attention expands inline under its row with what happened, the evidence in a sunken well, and at most one fix. A changed host key only offers to copy the command. "Add a host" is the page's one primary button.
- **Harness hue in Settings.** Beyond tiles and dither, a Harness hue may fill plan-limit meter cells, chart series and 8px legend squares, since those are identity. It still never colours text, buttons or selection.

### Onboarding

One brand moment, then the real shell; never a wizard. First launch shows a full-bleed scene (night or dawn) with the horizontal lockup, the tagline, one line saying what Polaris drives, and a single "Get started" button in the brand-moment size (see Buttons). A footer states what was found on this Mac (Harness versions, hosts in `~/.ssh/config`). After that, the app opens to the empty Orchestrator. The stage holds a clearing, the headline "Where does your code live?", and a `surface-raised` setup card with three rows: add a workspace (primary), connect a host (optional), and start a session (locked until a workspace exists). Adding a host uses the same inline components on day 1 and day 60. The first install shows platform, version, SHA-256 and install path in a sunken well, with "Approve and install" and "Not now". Each needs-attention reason (`host-key-unknown`, `host-key-changed`, `auth-failed`, `daemon-not-running`, `protocol-mismatch`) gets an inline card: what happened, the command or stderr line in a well, and at most one fix. A changed host key never gets a one-click fix. Mockups: Onboarding page, O1–O4.

### Empty states

Three tiers. **Stage**: the whole main area is empty (first run, a workspace with no sessions, a host with no workspaces). It uses the pixel scene with a clearing, as in New session. **Pane**: an inbox, the Review queue, a risk summary with no findings, the Editor with no file open, or an empty Constellation. It uses a 48px watercolour tile with a pixel icon, one `heading-sm` sentence, one `caption` line of fact, and at most one secondary action. There is no scene and no signal colour: "Nothing needs you" never uses the needs-you hue. A risk summary with no findings says what ran and what the user hasn't opened; it never implies the change is safe. **Inline**: a section or menu with nothing in it gets one `caption` line under its header ("None in polaris"). Mockups: Empty states page, X1. In the app: a host with no workspaces is the first-run stage ("Where does your code live?", 57Q-1); a workspace with no sessions is a stage headed "Nothing is running here yet" with a setup card (start a session, open a terminal); a workspace whose sessions aren't open is a pane ("No agent session open", "3 sessions in polaris · K to jump", New session); modes not built yet are panes too.

### Terminal

A drawer of Daemon terminals per Workspace, docked under Output (under the stage when no session is open), so the conversation keeps its full height. Hidden, it is a 28px strip ("Terminal ⌃`"); shown, a hairline-topped drawer (default 280px, resizable from its top edge, never under 120px or leaving less than that above) with a 36px header: tabs in `label` type (selected: `fill-selected`, `text-strong`), the cwd in `code-inline` `text-subtle`, and a hide control. ⌃` toggles it; showing an empty drawer opens the Workspace's shell. Tabs are the Workspace's shell and one per session handed off to its Harness's terminal UI.

- **Type.** SF Mono 12/16, weights 400 and 500 only; a Nerd Font, when installed, fills in prompt glyphs. Cursor is a bar that doesn't blink.
- **Colour.** Ground `bg`, text `text-default`, cursor `text-strong`, selection `text-strong` at 22%. The ANSI palette is moonlit (rule/syntax-is-moonlit): red and green are the `diff-*-text` hues mixed toward the foreground, yellow, blue and cyan are the syntax string, keyword and type tokens, magenta a mix of keyword and string. It follows the theme live.
- **Ending.** When the process exits, a 36px sunken bar under the terminal says so in `caption` ("Process exited with code 2"; with no code, "This terminal ended. The daemon restarted or the process was stopped") with one secondary action, "Open a new terminal here" (same cwd), or "Run again" on a hand-off tab. The output stays readable above it.
- **In Terminal.** "Open in terminal" is in the session menu. While the session is In Terminal, a sunken `row`-radius bar sits above the composer: the pixel terminal icon in `text-subtle`, "In terminal", one `caption` line ("Polaris follows along; take it back to send a turn"), a ghost "Show terminal" and "Take back", which returns the session and closes its tab.
- **Performance.** xterm.js on its WebGL renderer, loaded with the first terminal shown. Hidden terminals stay alive (up to four) so switching back is instant; beyond that the oldest is dropped and reattaching replays the Daemon's scrollback.

### Attachments in the composer

Pasted and dropped files stage on the session's Host straight away and show as source chips: a 16px thumbnail for images, the name in mono, the size in `text-subtle`, removable. While uploads run, one `caption` line says so ("Attaching 2 files…"). Dragging files over the composer shows a quiet hint over it (dashed hairline, `surface-raised` at 90%): "Drop to attach", and "Hold ⌥ to copy into the workspace instead". ⌥-drop copies the file into the session's directory on the Host and says so in a Polaris toast ("Copied notes.txt · Into ~/code/polaris"); it never overwrites.

### Needs You inbox

The sidebar's second view, across all machines. Each waiting session is a `card`-radius card with its Harness tile, title, and "Host · Workspace · age". Approvals show the command in a sunken code well and Approve / Always here / Deny. Questions show the question; the answer happens in the conversation, where the question renders as a card with a `needs-you` watercolour header strip and numbered answer rows (the recommended one filled). Failed and In Terminal sessions follow under "Also waiting on you" as compact one-line cards with a single action (Retry, Take back).

### Icons

Nucleo UI outline, 1px stroke, 16px, in `text-subtle` (or `text-strong` when selected), for all chrome. Nucleo pixel icons are only for Polaris-owned concepts (Session States, Harnesses, toast types) and always sit on the pixel grid. Never mix icon families within a component.

**Licence.** The icons are Nucleo (UI outline and pixel), vendored into the repo under Nucleo's licence (at most 100 icons, with its copyright notice). They are excluded from Polaris's Apache-2.0 licence and listed as such in `ATTRIBUTION.md`. The decision may be revisited (original icons, or a permissively licensed set) before the repo goes public.

**Feature marks.** A Polaris feature may get its own 16×16 pixel mark, drawn on the same grid as the north star and generated by `gen_dither.py`. The Constellation mark (`design/assets/icons/px-constellation-*.svg`) is three stars (a 5px sparkle, two 3px crosses and one lone pixel) joined by dotted lines, in Starlight because the graph is Polaris's own work. Feature marks label the feature on the marketing site, in docs and at the Constellation tab. They never stand in for a Session State.

### Motion

Quiet. Standard transitions are 120ms (hover, press), 160ms (small reveals), and 200ms (panels, toasts), all ease-out. No bounce, springs, or overshoot. Reduce Motion drops all transitions to instant fades and stills the dither.

### Performance

- Animate `transform` and `opacity` only. Anything that triggers layout or paint per frame (width, height, top, box-shadow, blur radius) does not animate.
- Springs are fine for panels and toasts when they drive `transform`. The Working dither steps a sprite strip by `transform`.
- Long lists and diffs are virtualised; nothing animates on scroll.

### Constellation (DAG)

A native take on herdr-dagr (ENG-169), planned for M4 · DAG automation. Terms are in `CONTEXT.md`: a Constellation holds Tasks; each try at a Task is an Attempt, carried out by an Agent Session; Gates are fan-in Tasks; Futures are declared but not started; Subagents nest under their session.

- **Where.** One Constellation tab per Workspace, in the Orchestrator's output pane, next to the orchestrating session's conversation, as in the herdr layout it replaces. The tab bar keeps "Message orchestrator (M)".
- **Rows, not a canvas.** The graph is a rail list in the spirit of `git log --graph`: a constellation trunk, collapsible project groups with their counts, tasks, and the attempts and subagents nested under them. Rows use the tree-row height. Fixed lanes, left to right: rail (60px), id in `code-inline`, title, actor (harness · model, "polaris reviewer" or "subagent"), and state.
- **Rail glyphs reuse Session State.** Working is a 10px dither in the harness hue (Starlight for Polaris's own reviewer); needs you is the pixel hand; done is a filled `text-subtle` dot; waiting is a hollow `text-faint` dot; a future is a dashed dot on a dashed branch; a gate is a small outlined square, never a diamond (that is Critical). Rail lines are white at ~14%.
- **Gates** show their inputs inline as small dots in each input's state colour, then an arrow and the gate's title; the state column says what they wait on ("waits A1R A2R").
- **State column.** `text-default` for working, `text-subtle` for done with its evidence ("done · verified"; tiers verified, reported, heuristic, asserted), `needs-you-text` for needs you, `text-subtle` for "waits X" and future (the hollow and dashed rail glyphs tell them apart).
- **Individual agent viewing is a focus swap.** Selecting a node (a task's attempt, a review, a subagent) swaps the middle column to that agent's own live session: a breadcrumb back to the orchestrator ("Polaris planning › Session rows v2 › A2"), the title and attempt, the brief it received (labelled "Brief from {orchestrator}"), its transcript and steps, and a composer that steers that agent directly. Every direct steer is also reported to the orchestrating session, so the orchestrator always knows what changed and why. The graph stays put; the selected row takes a translucent fill (lines show through) and a second line saying what the agent is doing now. There is no detail card.
- **Subagents are nodes.** Subagents a session spawns (from SubagentStart/Stop) nest under their parent with a smaller glyph and "subagent" as actor, and can be focused like any other agent.
- **Attention.** The constellation header carries the next thing that needs you as a needs-you chip ("B1 wants to run pnpm test", tab to jump). A key hint row sits at the foot: move, focus, fold, next that needs you, message orchestrator.

### Editor

The third mode (title-bar switch: Orchestrate, Review, Edit). Two zones: the explorer (264px, `surface-sunken`) and the editor pane. The code is the content; chrome stays neutral and quiet.

- **Explorer.** Workspace header (name, Host and path) and a Files / Changes segmented control, then the file tree in tree rows. Each row has two fixed trailing slots: an agent slot (a 12px dither in the Harness hue while a Working agent is changing that file, or the pixel needs-you hand on a folder where an agent is blocked) and a git slot (the status letter, or a 5px `git-modified` dot on a folder that contains changes). Below the tree, "Agents in {workspace}" lists that Workspace's sessions as session rows; the footer keeps the jump hint.
- **Git status.** Modified `M` (`git-modified`), added `A` and untracked `U` (`diff-added`), deleted `D` (`diff-removed`, name struck through), renamed `R` (`git-modified`), conflicted `C` (`diff-removed`), ignored (`text-faint`, no letter). Letters and the tinted file name use the `-text` variants (`git-modified-text`, `diff-*-text`). The file name takes the same tint unless the row is selected. In the gutter, a 2px bar marks changed lines (`git-modified` or `diff-added`) and a small `diff-removed` wedge marks where lines were deleted.
- **Tabs.** 36px, `label` type. The active tab joins the editor surface; others sit on `surface-sunken`. A dot means unsaved, a close mark shows on the active tab, and a 12px dither leads the tab while an agent is changing that file.
- **Breadcrumbs.** `caption` path and symbol in `text-subtle`/`text-default`, with the "Ask about this file ⌘I" hint on the right.
- **Code.** `code` type, moonlit syntax, line numbers right-aligned in `text-subtle` (the current line in `text-default` on `fill-hover`). Ligatures off. Tab completion is ghost text in `text-faint` with a small "Tab" keycap after it.
- **Selection actions.** Selecting code shows a small floating bar (`surface-raised`, `row` radius, float shadow) at the end of the selection's first line, clear of the code: "Edit or ask ⌘I" (inline chat on the selected lines) and "Add to agent session ⌘L" (attach the lines as a source). It disappears when the selection collapses and never covers selected text.
- **Inline chat (⌘I).** Opens as a `card`-radius raised card above the selection, aligned to the code's left edge: the Harness picker chip, the prompt, and the selected range. The selection keeps a Starlight fill at ~11%. The proposal renders inline as a diff (removed line on `diff-removed` fill, added lines on `diff-added` fill), and the card's footer says what changed ("1 change +2 −1 · Thought for 4s") with "Open as agent session", Reject (esc) and Accept (⌘↵, the view's one primary button).
- **An agent editing your file.** When a Working agent session is changing the open file, a Working strip runs across the top of the editor: dither glyph, "Claude Code is editing this file" in the Harness hue, "{session} · turn N · elapsed" in `caption`, a Follow checkbox (on by default: the view scrolls with the agent) and "Open session". Lines the agent wrote this turn get a 2px Harness-hue bar and a ~5% Harness-hue fill; its live caret is a Harness-hue bar with a name flag ("Claude Code"). No dither in the text area.
- **Status bar.** 26px, `caption`, `surface-sunken`. Left: Host (with latency when remote), branch and worktree, change count. Right: position or "Following Claude Code · Ln N", language, and Completions with the flat Polaris mark (Polaris's own feature).

### Titlebar

`titleBarStyle: hiddenInset` with native traffic lights, and a `-webkit-app-region: drag` header holding the wordmark lockup, the mode switch, and the jump field. Interactive elements in the header opt out of the drag region.

### Diff (Pierre Diffs)

Review renders diffs with Pierre Diffs inside shadow DOM, so Polaris styles it only through Pierre's CSS variables and one injected stylesheet (`unsafeCSS`). The token map (dark / light):

| Pierre variable | Polaris token |
|---|---|
| `--diffs-font-family` / `--diffs-font-size` / `--diffs-line-height` | `font-mono` / 13px (`code`) / 20px |
| `--diffs-header-font-family` | `font-sans` |
| `--diffs-bg` | `surface-sunken` (dark) / `surface-raised` (light) |
| `--diffs-fg` / `--diffs-fg-number` | `text-default` / `text-subtle` |
| `--diffs-addition-color-override` / `--diffs-deletion-color-override` | `diff-added-text` / `diff-removed-text` (or the `-cvd` pair) |
| `--diffs-bg-addition-override` / `--diffs-bg-deletion-override` | `diff-added` / `diff-removed` at ~10% over `--diffs-bg` |
| `--diffs-bg-addition-emphasis-override` / `--diffs-bg-deletion-emphasis-override` | the same at ~25% (word-level changes) |
| `--diffs-bg-separator-override` | `bg` (the "N unmodified lines" bands) |
| `--diffs-bg-hover-override` / `--diffs-bg-selection-override` | `fill-hover` / Starlight at ~16% |

The injected stylesheet adds only what variables can't: the Severity glyph in the gutter and the 2px Severity rule on a flagged line (which replaces Pierre's addition bar on that line), plus inline Risk Findings and pending comments as Pierre annotations.

## Do's and Don'ts

### Do:

- Use glossary terms exactly, in lowercase: "needs you", not "waiting"; "agent session", not "thread".
- Let neutral chrome carry the layout, and save colour for signals.
- Check every screen in both themes, at all three densities, and with the colourblind diff palette.
- Keep one primary button per view.
- Let a Harness's hue identify it everywhere it appears (dither, tile, toast, and the Working strip and Harness picker), and nowhere else.

### Don't:

- Use purple or neon gradients, gradient text, or glass effects (the "AI purple gradient" anti-reference).
- Put cards, charts, or panels on a view just to fill space.
- Animate anything other than the Working dither in a loop.
- Use Starlight on buttons, links, or selection.
- Put pixel scenes or dither behind code, diffs, or Orchestrator lists.
- Use blur as glow or emphasis; glow is a dither halo. Blur only separates floating layers (see Elevation).
- Use bold or semibold weights, all caps, emoji, or exclamation marks.
- Show a Severity as colour alone, or let anything hide or dim a Critical Finding.
