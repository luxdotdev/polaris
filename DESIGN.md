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
  # Starlight set as words (kickers, including on the dawn clearing): 5.5:1 on the clearing's worst pixel, 5.0:1+ on every light surface.
  starlight-text-dark: "#BCD3FF"
  starlight-text-light: "#2F5FC4"
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
  # Constellation: accepted work (done Tasks, passed checks). Only inside the Constellation tab, its sidebar group and Claims.
  accepted-dark: "#A8D65E"        # a yellow-green, so it never reads as Codex mint
  accepted-light: "#6B9A1F"
  accepted-text-dark: "#A8D65E"
  accepted-text-light: "#4F7A0E"
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
  # Colourblind diff text (counts, letters): 4.5:1+ on bg, sunken, raised, fill-selected and the cvd fills.
  diff-added-cvd-text-dark: "#5C9EFF"
  diff-added-cvd-text-light: "#0860C9"
  diff-removed-cvd-text-dark: "#DB8B2C"
  diff-removed-cvd-text-light: "#9A5A0E"
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
    rounded: "{rounded.row}" # at 32 and 40px; 8px at 28px and 12px at 48px (see Pixel tiles)
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

**Assets and source files.** Generated textures live in `design/assets/` (dither frames, state icons, scenes, watercolour washes, halos) and are reproducible from `design/scripts/gen_dither.py` and `design/scripts/gen_textures.py`. Mockups: the Paper file "Polaris — Orchestrator" (https://app.paper.design/file/01M3JV1J857QNW61TGHZYR6GMZ); artboard 5, "Orchestrate · Elevated", is the chosen Orchestrator direction, artboard 7 shows a constellation with a subagent in focus, the Review page holds R1 (pull request, dark) and R2 (agent session turns, light), with M2's proposed states in R3 (pull requests, dark), R4 (review checkout menu, dark), R5 (review checkout states, light), R6 (comment composer, dark), R7 (submit review, dark) and R8 (agent session feedback, light), and the Editor page holds E1 (editor, dark), E2a (selection, dark), E2 (inline chat, dark) and E3 (an agent editing your file, light). The file's Paper tokens mirror this frontmatter as `-dark`/`-light` pairs.

**Mode:** Operate. Scanability, consistency, and native macOS expectations outrank expression. Brand lives in precise details and the pixel world.

### Brand

- **Wordmark:** "Polaris" in Geist Pixel, style Square (from the `geist` package, SIL OFL), title case. It appears only where Polaris names itself: the title bar (13px, after the traffic lights, beside the 16px star), About, onboarding, and app icon lockups. Never in working UI copy.
- **Mark:** a symmetric 16×16 pixel star: a 2px spine, rays that step out evenly (2, 4, 6, 8, 16 pixels wide), and short diagonal rays, in the spirit of Minecraft's Nether star. At 24px and up it is shaded in three tones (outline, body, white core): `design/assets/brand/polaris-logo-*.svg`. Below 24px it is flat: `design/assets/icons/px-polaris-*.svg`. Both are generated by `gen_dither.py`. Colourways: Starlight on dark, blue on white, ink or white for one-colour use. Smallest size is 16px; the title bar pairs it with the 13px wordmark.
- **Idea and tagline:** Polaris is the fixed point your agents steer by. Tagline: "The north star for your agents." Principles: calm, precise, alive.
- **Lockups:** horizontal (default), stacked, and mark only. Clear space on every side equals a quarter of the mark. The star always leads the wordmark.
- **App icon:** the night-sky scene cropped around Polaris, in the macOS squircle, with the shaded Starlight mark centred. At 32px and below the sky flattens to Night and the star goes flat. It is generated by `design/scripts/gen_app_icon.py` into `design/assets/app-icon/` (`Polaris.icns`, the iconset, a Linux PNG set and a 1024px master): the macOS grid (an 824px squircle body in a 1024 canvas, superellipse n=5) with the brand deck's 8% white inner hairline and a soft drop shadow, the scene crop and star share (58% of the body) of the Brand deck's 07 slide, and every size drawn natively so the star stays on whole pixels. At 16px the 16-cell star cannot fit, so a 7×7 flat star stands in. **Dev variant (dusk):** builds run from source (`Polaris Dev.app`, the dev Dock icon) use the same squircle, star and size ladder over a dithered pixel sunset instead of the night crop, so dev is told apart at a glance. Top to bottom: Night `#0A0D1A`, navy `#161B36`, violet `#2A2350`/`#4A2D63` behind the star, rose `#7A3A6E`/`#B5577A`, ember `#E07F5F` and a Lamplight `#F2C27A` horizon under a dark ridge `#0D1022`, with a few early stars in the upper corners. The star stays Starlight and sits on violet. At 32px and below the bands go flat with no dither. Generated into `design/assets/app-icon/dusk/` (`PolarisDev.icns`). The shipped app never uses it. The menu bar item is the flat white star plus the needs-you count. On macOS it outlives the window: closing the last window hides Polaris rather than quitting it, so the star, notifications and the Dock badge keep counting; the star's Open Polaris, the Dock icon or a notification brings the window back, and only Quit (⌘Q or the star's menu) ends Polaris.
- **Brand colours:** Night `#0A0D1A` (brand ground), Charcoal `#1A1B1D` (product dark), Starlight `#BCD3FF` (the only brand hue), Starlight deep `#4F82E8` (on light), Snow `#F4F5F7`, Ink `#17181A`, and Lamplight `#F2C27A` (the cabin window, rare). Roughly 60 / 22 / 9 / 6 / 2 / 1. Signal colours never appear in marketing.
- **Brand type:** Geist Pixel is the wordmark only. Headlines and body in brand materials are SF Pro (medium and regular); code and data are SF Mono.
- **The twinkle:** on launch only, the star's core brightens for two frames. The mark never animates anywhere else.
- **Brand deck:** the "Brand deck" page of the Paper file (12 slides: cover, idea, principles, voice, mark, logo, app icon, colour, typography, pixel world, icons and motion, applications).
- Draw the mark on whole pixels only; never rotate, outline, or anti-alias it.
- **Marketing site:** the "Marketing site" page of the Paper file (S1, desktop, dark, a draft). It uses the brand deck's system: Night ground, the night-sky scene in the hero and the closing CTA only, SF Pro Regular headlines with tight tracking, mono section kickers (`01 — Supervise`), and real product shots exported from accepted artboards (`design/assets/site/`), never redrawn UI. One primary action on every screen, "Download for macOS", as a Snow button; the secondary action is always the source. Starlight stays off buttons and links here too (rule/starlight-is-rare), and signal colours appear only inside product shots. Until the repo is public, every source link reads "Source opens soon" and leads to a one-email notify form. Copy names what Polaris does, not the hardware it runs on: hosts are "this Mac" or "any machine you can reach over SSH". The footer credits lux.dev LLC ("An open source project by lux.dev", "© 2026 lux.dev LLC"). rule/scene-text-contrast holds on the site too: the nav sits on a solid Night bar (~95%) with links in `#C9D0E0`, never directly on the sky, and buttons over a scene are opaque. S2 is the light version: the dawn scene in the hero (faded into `bg-light` above the product shot) and the closing CTA, light product shots, ink primary buttons, the blue colourway of the mark, and light dither and wash variants. S3 is mobile (390, dark): one column, shots bleed off the right edge, and because a phone cannot install a Mac app the primary action becomes "Email me the Mac download" (email field plus button) instead of Download.

## Colors

### Primary

**Starlight** (`starlight-dark` #BCD3FF, `starlight-light` #4F82E8) is the brand: a cool white-blue. It appears in exactly four places: keyboard focus rings, the activity indicator and dither for Polaris's own work (such as the Risk Summary reviewer), the logo mark, and the star in the night-sky scene. Where Starlight is set as words (the Starlight kicker over a scene), it uses `starlight-text`: the same #BCD3FF in dark, and #2F5FC4 in light, because #4F82E8 is 3.5:1 on the dawn clearing (rule/scene-text-contrast).

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
| Accepted | `accepted` (yellow-green) | Constellations only: an accepted Task or Gate with its evidence, a passed check in a Claim or receipt. Never a Session State. |
| Critical ◆ | `severity-critical` (red) | Review and Output. Secrets, security, data loss. Always visible; no Risk Memory hides it. Low-confidence generic secret matches are Medium, not Critical. |
| High ▲ | `severity-high` (orange) | Review and Output. |
| Medium ● | `severity-medium` (yellow) | Review and Output. |
| Low ○ | `severity-low` (slate) | Review and Output. |
| Diff added / removed | `diff-added`, `diff-removed` at ~12% line fill, ~25% word highlight; counts and letters in `diff-*-text` | Review and Editor. `-cvd` blue/orange set in settings, with `diff-*-cvd-text` for counts and letters. |

### Harness identity

Each Harness has one fixed hue; every Agent Session with that Harness uses it. Claude Code is `harness-claude-code` (coral orange; `-light` #C4562F). Codex is `harness-codex` (mint; `-light` #1E8A5C). Where the hue is text in light mode, it uses `harness-*-text-light` (rule/signal-text-variants). OpenCode is `harness-opencode` (rose, provisional; wash and dither generated by `gen_textures.py` and `gen_dither.py`). These are provisional until checked against the signal colours in real screens. Harness hue appears in the dither, the session's Harness tile, and toasts that Harness sent. It may also colour text and borders in exactly three places: the Working strip (in the composer, and across the top of an Editor file an agent is editing), the Harness picker chip, and an agent's live caret and lines in the Editor (see Components). It never appears on buttons, selection, or body text.

### Named Rules

- **rule/colour-means-something:** a colour on screen must be Starlight, a Session State signal, a Constellation state (rule/constellation-colour), a Severity, a diff, a git status, a syntax token, or a Harness hue. Anything else is a neutral.
- **rule/syntax-is-moonlit:** syntax colours stay low-chroma and never reuse a signal hue, so a Severity, diff or Needs You mark is always the loudest thing over code.
- **rule/git-is-a-letter:** a git status is always its letter (M, A, U, D, R, C, !) in a fixed slot, with the file name tinted to match. It never uses a dot or icon alone, so modified tan never reads as Needs You yellow (which is always a pixel icon).
- **rule/constellation-colour:** inside a Constellation (the tab, its sidebar group, Claims and its Needs you cards) each Task state reads at a glance: working keeps the Harness hue on its dither (and in the progress strip), done with evidence is `accepted` on glyph, id and state word, needs you is `needs-you`, a failed check is `failed-text`; in review, waiting and Futures stay neutral. `accepted` appears nowhere else, and Starlight stays out of it.
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
- **rule/commands-are-chips:** a Skill or Slash Command in the composer is an atomic, neutral chip with its kind's icon, never raw `/text` or a coloured pill; one Polaris runs itself leaves no chip, and one only a Harness's terminal UI can run is never offered.

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

**Exception, machine mode (Paper MX-0):** with the machine bar, the sidebar groups a machine's sessions by Workspace, and those grouped rows are 32px single-line glyph rows (a 16px state glyph, the title, the age), not tile rows, so many Workspaces fit. The two-line tile row is for a single Workspace's sessions.

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

- **rule/only-working-moves:** on working surfaces nothing loops except the Working dither. The other moving things are a pixel scene's ambient life (see Pixel scenes), and scenes never sit behind working surfaces, and the effort bar while the Harness picker is open (see Harness picker).
- **rule/needs-you-is-loudest:** Needs You is the only Session State with an attention colour, and it sorts to the top.

### Risk Findings

A Finding row carries a Severity badge in a fixed-width slot, then the reason, then the confidence. The badge is 20px tall, 6px radius, a soft tint of the Severity colour with the shape glyph and label in the full colour: ◆ Critical (red), ▲ High (orange), ● Medium (yellow), ○ Low (slate). A Risk Summary ranks by Severity, then confidence; non-Critical Findings under 50% confidence are dimmed. In Output's Changes tab, the same badge sits in the file header and on the flagged line's gutter.

### Review

The Review view mirrors the Orchestrator's three zones: **queue** (left), **risk column** (360px), **diff** (the largest pane). The same layout serves a pull request and an agent session's turns.

- **Queue.** Groups in this order: Review requested, Agent sessions ready, Mine, Other open, then "Review a PR by URL" in the footer. PR rows are two-line session-style rows with a neutral PR tile; agent sessions use their Harness tile. Each row ends with its highest Severity glyph and count ("▲ 1", "◆ 1").
- **Subject header.** Title plus number, then one caption line (author, base and head branches as mono chips, repo). On the right: the review checkout chip ("Checked out on Linux VM · at 4f2c1a · Run") and the one primary action. For a PR it is "Submit review" with the pending-comment count; for an agent session it is a split button "Accept and open PR", preceded by a turn picker (22 · 23 · 24 · All).
- **The reviewer is Polaris.** The risk summary is Polaris's own work, so it carries the Starlight identity: a Starlight-washed tile with the pixel north-star mark (`design/assets/icons/px-polaris-*.svg`). The same mark prefixes "Ask the reviewer" and reviewer-authored proposals.
- **Risk column.** Header, then a four-cell Severity tally (◆ ▲ ● ○ with counts; zero cells go faint), then findings ranked by Severity then confidence. The selected finding expands into a card with a hanging indent: badge on the left, title, reason and `file:line · source · confidence` aligned on the title's edge, and the verdict buttons (thumbs up/down) trailing. Below the findings: files with Viewed checkboxes, a progress bar ("3 of 7 viewed") and each file's highest Severity glyph. "Ask the reviewer" sits at the bottom as a composer.
- **Diff.** File cards with the Severity badge and a Viewed checkbox in the header, a hunk header band in 11px mono (`@@ -36,7 +36,8 @@` and the symbol git names, `submitEligibility`, beside the unmodified-line count and its expand control), and the flagged line marked twice: the Severity glyph in the gutter and a 2px inset rule in the Severity colour. Pending comments render inline under their line as raised cards labelled "Pending · Goes out with your review", linked to the finding they answer. Agent-session diffs group by turn, newest first, with a divider that quotes the turn's prompt; older and reviewed turns fold, a run of them to one line ("Turns 22–23") that quotes the newest one's prompt (turns have no summary of their own), with a check when every file in them is viewed.
- **Verdict popover.** Opens from thumbs-down beside the finding: "Why is this not a problem?" over one honest line ("It moves to dismissed; the verdict stays with this repo’s reviews."), ENG-225's fixed reason pills (False positive, Not important, Intended, Already handled, Wrong severity, Out of scope, Other…), an optional note ("Other" needs one), a scope segmented control (This change / This repo / Everywhere, This repo by default), and a sunken footer with the Polaris mark, "Rules never change without you", and "Save verdict". In M2 a verdict only dismisses (nothing learns yet), so the copy never promises learning; a dismissed finding collapses into "Show dismissed · N" (a critical one stays listed, saying it was dismissed). An earlier verdict on the same code shows in the expanded card ("You dismissed a similar finding here: intended").
- **Critical findings pause acceptance.** While any critical finding is open, the accept action shows as a disabled button reading "Accept paused · 1 critical", and the critical card says so in plain words. Nothing hides or dims a critical finding.
- **Feedback for the next turn.** On an agent session, comments batch into a sunken card "Feedback for turn N" that quotes the lines and sends with a Harness-picker-style chip ("Send to @claude").
- **Pull requests (R3, proposed).** With no subject open, Review is the full list: `display` title, one caption ("13 open in 7 repos · matched to workspaces on 3 hosts · updated 1m ago"), an account filter (All accounts plus one segment per GitHub account) and "Review a PR by URL". The queue's groups in the same order, with fixed lanes: tile, title over `#n · owner/repo · author`, workspace over host (and "checked out" when a review checkout exists), changes in diff colours, risk (highest Severity glyph and count, or "Not run": a risk summary only runs when a review opens, and the list never implies a change is safe), updated. A host that is reconnecting dims only the workspace lane; the pull request itself comes from GitHub. An owner none of the accounts can see gets one neutral notice above the list ("No GitHub account for acme-corp", Add account / Not now: routing already tries every account, so choosing among them can't help), and an organization that hasn't approved Polaris another (Request access, Sign in with SSO, Check again), never a signal colour. The Review tab counts review requests in plain `text-subtle` figures (no wash: they aren't sessions that need you). Needs You's inbox ends with a **Reviews** group: a raised card per review-requested pull request (the neutral PR tile, the title on up to two lines, `#n · repo · author · age`), the whole card opening it in Review.
- **Stacks (no artboard).** A pull request that is a layer of a stack says so in three places.
  - **Header.** The caption line starts with a status pill (Open, Draft, Merged or Closed, each with its own glyph), then a stack chip ("2/4" with a layers glyph), then the author, then base ← head as mono chips on one line. Each chip is cut after 20 characters with an ellipsis; hovering it shows the whole name, and a click copies it.
  - **Popover.** Hovering the stack chip opens it, and so do a click or ↵, which also move focus into it. Its title is "Stack #635", or "Stack from branch names" for an inferred stack. It lists the layers top (newest) first, the current one on `fill-selected`. Each layer shows its status glyph, its title, and `#n · branch…` with its checks ("4 checks", "2 checks failing" in `failed-text`, "10 checks running") and `+/−` trailing. The trunk sits under the last layer, as a hollow dot and a mono chip. Choosing a layer opens its Review.
  - **Pull list.** Rows show the same chip, static and smaller, after the title. A stack's layers stay together in their group, top first, where its newest layer stood.
  - **Colour.** A pull request's status is not a signal: the pill is neutral (`fill-selected` while open or draft, a hairline outline when merged or closed). The only colour is failing checks.
  - **Where stacks come from.** GitHub's own stack, read with the list and on github.com only (docs/research/github-stacks.md). Otherwise it is inferred from the open pull requests: a base that is another's head, in the same repository and not from a fork, down to the first base that isn't (the trunk).
  - **What isn't a stack.** A branch point (two pull requests on one base) and a cycle are not called stacks, because a linear "2/4" would mislead there; GitHub's own stacks are linear too.
  - **Review Checkout.** A layer's checkout is compared with its own base (the layer below), as GitHub's diff is, never with the trunk.
- **Review checkout chip (R4, R5, proposed).** States: checking out, ready ("Run"), running ("Stop"), new commits ("Update"), updating, host reconnecting (last known, dimmed), host offline (offers the next host with the repo), failed (the git error in mono under the chip; fetches use the host's credentials), not on any host ("Clone on…") and removed (dashed, after merge or close). Clicking opens a menu: the new commits with "Update checkout" (then the risk summary reruns on those commits only), "Check out on" with every host that has the repo (last used first, latency trailing), Run / terminal / editor, and a sunken footer with the worktree path and "Remove checkout". Until an update, diff, findings and Viewed marks stay at the old head; files the new commits touch lose Viewed. Run starts the checkout's own `dev` script (else `start`) with the package manager its lockfile names, through the user's login shell, in a terminal tab of the checkout's Workspace; it has no shortcut, because ⌘R is the Develop menu's Reload. The new commits are GitHub's comparison of the checkout's commit with the head: "2 new commits" in the chip, a row per commit (sha, headline, age) in the menu, "force-pushed" when the branch was rewritten. "Clone on…" clones into `~/code/<name>` on the connected Host the user picks (over ssh, the Host's credentials), adds it as a workspace, and the checkout opens there. Chip and menu rows take density's `row` height.
- **Comment composer (R6, R8, proposed).** Selecting lines tints them with `diff-selection` and opens the composer under the last one: a raised card with the focus ring, the line range in mono, who it goes to (the GitHub account for a PR, "Goes to Claude Code with turn N" for an agent session), the text, then Suggest change, a linked finding chip (dashed "Link a finding" when none), Cancel esc, a secondary send-at-once ("Comment now" / "Send now") and the primary that batches ("Add to review ⌘↵" / "Add to feedback ⌘↵"). "Comment now" stays visible while a review is pending; since GitHub publishes a pending review as a whole, it then sends the pending comments too, and its tooltip says so ("Publishes your 2 pending comments with it"). An agent session's composer names its place `file:line`.
- **Submit review (R7, proposed).** A popover from "Submit review": the summary, Comment / Approve / Request changes as radio rows whose captions state consequences ("1 high finding is still open"), "Goes out with it" listing each pending comment by `file:line` plus the Viewed count, and a sunken footer naming the account and owner with the primary repeating the choice ("Request changes ⌘↵").
- **Tabs and Overview (R9).** Review's centre pane has tabs: Overview · Changes · Conversation · Commits · Checks for a pull request, Overview · Changes for an Agent Session; each label carries its figure in `text-subtle`, the chosen one sits on `fill-selected`, and "Review changes →" trails (⇧⌘[ / ⇧⌘] cycle; the tab is remembered per Review while the app runs). Every Review opens on Overview: the description (Markdown), a review bot's summary pinned as a card (bot mark, the verdict pill in its alert's Severity colour, the first paragraph and checks line, the full GFM on demand, "N commits behind" when stale, its commands behind ⋯ that ask once per bot because they post as the user), the Walkthrough with the Polaris mark (writing with placeholder lines, ask first as one "Run both", failed with the Harness's own error), and a one-line link to Conversation. On re-review "New since your last review" leads with a short Walkthrough of the new commits, and the description and full Walkthrough fold to one line each. Paths in a Walkthrough open in Changes and a finding chip selects its finding; `diff` blocks use the diff fills. Overview has no composer: Conversation's composer adds to the pending review. ⌃1…⌃9 in Review open the queue's first nine rows; holding ⌃ shows them.
- **Risk memory proposals.** When verdicts suggest a rule, the reviewer proposes it in a Starlight-bordered card at the foot of the risk column: the rule in plain words, "from N verdicts", and Approve / Keep private / Not now. The reviewer never changes its own rules without this approval.

### Badges

20px tall, 6px radius, `caption` type, a soft fill of the base hue at 12% (dark) / 10% (light) with the label in the hue's `-text` variant (like "New" or "Connected"). Every label clears 4.5:1 on its fill. Used for counts, Severity, and short status words; never for decoration.

### Pixel tiles

A square tile holding a Nucleo pixel icon over a watercolour wash. Sizes are 24, 32 (default), and 40px, with a 1px hairline; Review's Turn divider uses 18px and its session header 36px (Paper R2). The radius scales with the tile, as built: 5px on 18px tiles, 8px on 28px tiles (session rows, inbox cards), `row` (10px) on 32, 36 and 40px tiles, and 12px on 48px tiles (pane empty states, setup rows); a small tile at 10px would read as a status dot. The wash is a soft, slightly grainy tint of the identity hue (a Harness hue, or Starlight for Polaris). Tiles represent identities and Polaris-owned concepts: Harnesses, Agent Sessions, toast sources. They are never used as generic decoration on list rows.

### Toasts

Bottom-right, 360px wide, 16px in from the window's edges, and clear of the 28px Terminal strip under Output (44px up) and the collapsed Output rail (its width further in; the shell sets `--toast-inset-right` and `--toast-inset-bottom`). They never cover the composer. `card` radius, `surface-raised` with a float shadow. Leading edge: a pixel tile, full toast height, washed in the **source's** hue (the Harness that sent it, or Starlight for Polaris). Title in `heading`, one line of `body` in `text-subtle`, at most one action. Whether the news is good or bad is carried by the pixel icon and the words, never by the wash.

### Harness picker

A chip in every composer: a small Harness tile, `@claude` or `@codex` in `label` type, the model in `caption`, and a chevron. It may take the Harness hue on its text and a 30% Harness-hue border while that Harness is Working. On the new-session page it expands into the Harness choice (see New session).

- **Models: the newest four.** The menu shows four Models, the newest of each family in the Harness's own order: a Model is set aside when the Harness also lists a newer one of its family (read from the name it shows, "Opus 5.5" over "Opus 5", "GPT-6.1-Sol" over "GPT-6-Sol"), and the Harness's default is always among them. Today that is Opus 5.5, Fable 5.1, Sonnet 5.5 and Haiku 4.5 for Claude Code, and GPT-6.1-Sol, GPT-6-Astra, GPT-6-Luna and GPT-5.6-Terra for Codex. Everything else is under "More models…". Settings → Harnesses' "New sessions start with" offers the same four (plus a saved Model outside them).
- **Effort: a dither bar.** Under the Models, the selected Model's effort is a row of 2px-cell dither segments in the Harness hue, one per level, lit up to the current one, with the level named on the right in `caption`. Each lit segment is denser than the one before; the lowest level is still and sparse, and each step up steps the field faster (from still to 70ms a frame at the top). ← and → move it, Home and End jump, a click on a segment picks that level. It moves only while the menu is open, and Reduce Motion stills it to its density alone.
- **Picks are sent once.** Choosing a Model keeps the menu open so its effort can follow; what the menu shows is sent when it closes (click outside, Enter, or a click on a segment), as one `SetModel` or Fork. Escape closes it without sending.

### Working strip

While a Turn runs, the composer grows a 34px strip across its top: a dither glyph, a working verb ("Flat out…") in the Harness hue, elapsed time in `text-subtle`, and a Stop control (esc) on the right. The strip has no band of its own (no sunken fill, no rule under it): it sits on the composer's surface, and its only ground is a fine dot field in the Harness hue: 1px dots on a 2px grid over a faint tint (dots ~29%, tint ~9% at rest), densest behind the glyph and label at the top-left and thinning out (dots drop by an ordered Bayer threshold) by ~150px right and the strip's bottom. Light theme raises the dots to ~1.25× and lowers the tint so they read at the same weight. The composer's border takes the Harness hue at ~28% with a 3px outer ring at ~6%. This strip is the loudest thing on a Working screen and replaces any spinner.

- **The field answers the pointer and the status.** While the pointer is over the Working composer, a small patch (~22px radius) of sparse `text-strong` dots on a staggered 8×4px lattice follows it (in over 90ms, out over 160ms), and the hue dots brighten in a trail behind it that fades over ~0.4s. When the strip appears or its status line changes, the corner blooms: it floods out to ~1.3× its reach over 400ms, then settles to rest over 900ms. Only the glyph loops (rule/only-working-moves). It is drawn on a canvas at one pixel per CSS px, painted only while the patch, trail or bloom moves: no frames while the pointer is away or resting, and none under Reduce Motion, where the field is the still resting corner.

- **The working verb** rotates, as ChatDCA's does: a random first verb, then the next every 6s, faded in over 160ms (opacity only); Reduce Motion swaps it instantly and keeps rotating, since a text change isn't motion. It never re-blooms the field. Screen readers hear "Claude Code is working" instead of each verb. Claude Code sessions use `spinnerVerbs` from Claude Code's own settings on that Host, as Claude Code applies them (`~/.claude/settings.json` < the project's `.claude/settings.json` < `.claude/settings.local.json`; `replace` uses only those, `append` adds them after Polaris's). Otherwise, and for every other Harness, Polaris's built-in list, which the user edits in Settings → Sessions → Working verbs. A verb without an ending gets "…".
- **Keys while a Turn runs.** ↵ steers the Turn in flight; ⌘↵ queues the draft as a follow-up that is sent as the next Turn when this one ends. The placeholder says both: "Steer this turn · ⌘↵ to queue a follow-up". A Harness that can't be steered takes ↵ as queue, and the placeholder reads "Queue a follow-up for after this turn". Steers and queued follow-ups show at once at the end of the conversation as the user's own bubble at 60% opacity, with a caption: "Steering…" until the Harness takes the steer, then it sits in the Turn where it landed as a full bubble captioned "Steered this turn"; "Queued for after this turn" with Cancel (back into the draft) until the follow-up starts the next Turn, whose prompt it becomes. One that doesn't land (refused, or the Turn ended first) stays at full opacity with a pixel failed glyph, the reason in `caption`, Edit (back into the draft) and Retry ("Send as next turn" for a steer whose Turn is over). Nothing the user sends ever disappears.
- **While a question is open,** the composer answers it in free text: "Or answer in your own words". While an approval is open it is locked with "Answer the request above to go on".

### Sources

The selected session's Sources show as chips, not rows: a brand mark tinted by its own brand (Linear indigo, GitHub neutral) plus the identifier, files in `code-inline`, and a dashed "+ Add" chip. Brand colour here is the brand's, not Polaris's, and stays at chip scale.

### Turns in the conversation

Earlier Turns collapse to a one-line card (Turn number, summary, +/−, chevron). Assistant prose is Markdown (Streamdown): headings step down to `heading`/`heading-sm`, lists, tables in `caption`, blockquotes with a hairline rule, inline code on `surface-sunken`, and fenced code in a `row`-radius sunken well with the language and a copy action, coloured by the syntax tokens (rule/syntax-is-moonlit). Mermaid diagrams and KaTeX math render in place, on the same tokens in both themes; links open in the browser. The user's own prompts stay plain text. A command that succeeds folds its output to its one line (command, "N lines", exit, chevron) two seconds after it finishes, never while it runs, never when it failed, and never under the pointer; a click opens it again, and the user's choice sticks. The live Turn shows the Harness tile as its avatar, a "Thought for Ns" disclosure, a stacked sources pill, the prose, and a step checklist in a `row`-radius well: done steps get a check in `text-subtle`, the current step gets the dither and a faint Harness-hue fill, and pending steps get a hollow dot in `text-faint`.

- **Thinking.** While the Harness thinks, the disclosure reads "Thinking…" after a 12px dither, with the time so far in `text-faint` tabular figures ("Thinking… 4s"), ticking once a second. Done, it reads "Thought for 12s" (under a second reads "1s"; a minute or more "1m 20s"); a Harness or older log without times reads "Thought". Thinking with no text to show keeps its row but has no chevron.
- **Step details.** The current step reads what it is doing now when the Harness says so (Claude Code's present-tense form, "Running the tests"), as Claude Code's own list does, with the step's text as its tooltip; other steps read their text. A plan's explanation (Codex says why the plan is what it is) trails the steps inside the well as one `caption` line in `text-subtle` above a hairline, clamped to two lines.
- **rule/context-is-quiet:** the session header shows how full the Agent Session's context window is as "Context 42%" in `caption`, `text-subtle`, tabular, before the permission mode; the tooltip gives the tokens ("84k of 200k tokens in context"). From 85% the words change ("Context 91% · nearly full"), never the colour: context is not a Session State or a Severity (rule/colour-means-something). Hidden until the Harness reports its Model's window; a Harness that never does shows nothing. In a narrow column it truncates first (state and permission mode stay whole), and its tooltip carries the whole line.

### Tool runs and Subagents in the conversation

Adapted from ChatDCA, which follows Claude Code; DESIGN.md sets the look.

- **Tool runs.** Consecutive successful reads, searches, fetches, web searches, edits and commands fold into one `caption` line in `text-subtle` with a faint check and a chevron: "Read 3 files, searched for 2 patterns, edited 2 files, ran 4 commands". The phrases always come in that order, whatever order the calls ran in, and edits count distinct files. A click opens the calls under a hairline rule, each as its usual row (commands keep their own folding). A call that is running, failed or declined, any other tool, prose, reasoning, a plan or a steer breaks the run and keeps its own row; a lone call is never folded. Tool rows read as verbs: "Read", "Searched", "Found files", "Fetched", "Searched the web", or "Reading", "Searching"… while running; a failed or declined call gets the pixel failed glyph, never a check.
- **Subagents.** A Subagent takes the place of the call that spawned it, as a `row`-radius well. Its header shows the status (the Harness dither while working, a check when done, the pixel failed glyph when it failed or stopped), the agent's name in `caption` medium ("Explore", or "Subagent"), its title, the elapsed time, its state ("done", "failed", "stopped") and a chevron. While it works, one mono `caption` line says what it is doing now ("Running bun test"). When it finishes, its report (its last message, or what its call returned) shows under the header as Markdown and stays there; this is never folded away. Opening it shows the task the Turn gave it, as a quote with a hairline rule, then its own transcript, grouped into runs the same way. A Subagent without a spawning call (a background agent) closes its Turn.

### Dither halo

The only way Polaris adds glow or emphasis: an ordered-dither radial field in a single hue (Starlight or a Harness hue), drawn as pixels at ~35% alpha. Glow is always a dither halo, never a blur or a soft coloured shadow, because the pixel field is the brand. Used as the Working strip's field (see Working strip) and around Polaris in scenes. Never behind text that must be read.

### Dither

The signature component: a field of square cells lit on a strict pixel grid.

- **Geometry:** cells are 2pt squares on a fixed grid, lit by an ordered (Bayer 4x4) threshold pattern. No blur, no anti-aliasing, no gradients.
- **Timing:** a new frame every ~83ms (12 fps), so it reads as pixel animation, not video. It fades in over 200ms on entering Working and fades out over 200ms on leaving it.
- **Colour:** the Harness hue, or Starlight for Polaris's own work.
- **Implementation:** frames of lit cells baked into a horizontal sprite strip, stepped by translating the strip (`transform`) inside a clipped box, so the animation stays on the compositor. Canvas is acceptable for large fields such as scenes and for the Working strip's pointer field, which follows the pointer at display rate (on the cell grid) rather than at 12 fps.
- **Where:** the Working indicator, the composer while a Turn is being sent, mode or Harness activation moments, and 12px marks in the Editor's file tree and tabs on files a Working agent is changing. Never in the Editor's text area or behind diffs.
- **Reduce Motion:** replaced by a still pixel pattern.

### Pixel scenes

Full-bleed pixel illustrations: a night sky with Polaris for dark mode, a meadow at dawn for light mode. Only in onboarding, first run, and empty states (including the new-session page), never behind working surfaces (Orchestrator lists, Review, the Editor). Content over a scene sits on a `surface-raised` card. The current scenes are generated by `design/scripts/gen_textures.py`; do not copy the inspiration images. Both scenes carry the same cabin, seated on the ground line: moonlit with a lit window at night, warm timber with the lamp still on at dawn.

- **Ambient life.** Scenes are alive, quietly: a few stars twinkle at a time (at most three, each brightening one or two palette steps, settling, dimming toward the sky and settling again over 3–5s); the cabin's lit window and door gap breathe through four levels of their own lamplight, one level at a time (two slow waves of 3.7s and 6.1s with a rare brief dip, never a strobe); single smoke pixels rise a pixel a second from the chimney and drift with the wind as they fade. Now and then a visitor crosses: at night a meteor (a 40–70 pixel whole-pixel streak at one in two with a three-tone tail in the star palette, 25–70s apart), at dawn a V of three or five 3×2 birds flapping through three frames, a pixel every 110ms (40–90s apart). Visitors only take paths through clear sky, above the hills and clear of the headline, the setup card and any other content; with no clear path they skip their turn.
- **How it is drawn.** Everything animated comes from the scene's own map (`design/assets/scenes/scene-*.json`, written by `gen_textures.py` beside the PNG) in the scene's own colours, on one scene-sized canvas (one canvas pixel per scene pixel) scaled and placed exactly as the background is. It steps twice a second (a meteor or birds step faster while they cross), paints only when a pixel changes, and stops entirely when the window is hidden, the scene is off screen, Reduce Motion is on, or nobody has touched the window for 3 minutes (it wakes on the next input). Working surfaces never show a scene, so they never pay for it.

- **rule/scene-text-contrast:** any text set directly on a scene sits on a "clearing": a solid radial vignette of the scene's darkest colour (dark: `#070912` at ~90% in the centre, fading to 0) sized to the text block plus 80px, and secondary lines use `text-default`, not `text-subtle`. Every line must clear 4.5:1 against the worst pixel behind it, stars included.

### New session

The empty-state page for starting an Agent Session. Night-sky scene (dawn in light mode) fills the stage; the sidebar stays. A clearing holds a Starlight kicker in `starlight-text` ("New session · polaris"), the `display` headline "What should happen next?", and one line saying where it runs (Host, path, Worktree): "Runs on Mac Studio in ~/code/polaris, in place." Its placement phrase opens a menu (in place, on a new worktree, an existing worktree). The Host and the path are menus too (dotted underline, no chevron): the Host menu lists every Host with what it holds or its Connection State (only connected ones can be chosen), and moving to a Host with no workspace starts in its home, as ⌘N does; the path menu lists the Host's workspaces and ends with "Open folder…" (⌘O on that Host). The draft follows the move. A session works **in place, in the workspace directory, by default**; a new worktree is the user's choice, per session or as the default in Settings → Sessions ("Start on a new worktree", off). Several sessions may share one directory at once; the line says so rather than warning: "…, in place alongside 2 other sessions." A new worktree's branch is the branch prefix (Settings → Sessions, "polaris/" by default), the prompt's first words and four characters of the session's id ("polaris/fix-the-flaky-test-3f9a"), so the same prompt twice never collides. Below it, the composer on a `surface-raised` card. Below that, the Harness choice as **balanced rows of equal cards spanning the composer's width**: up to three Harness cards, then Fork a Turn, three to a row; four cards wrap two to a row so names fit. Only Harnesses that are ready or need sign-in get a card; with more than three, the three most recently used ready ones do, and the rest wait behind "Other harnesses (N)", which opens the Host's Harness availability (each with its setup line and docs). With none ready, a panel lists every Harness with its reason in one line ("Claude Code 2.1.272 · needs 2.1.283 or newer") and Start stays off. Each is 56px tall with a 48px watercolour tile on its leading edge, a 14px title and a one-line `caption`; the selected card gets `text-strong`, a brighter hairline and a check. No staggering or cascade.

### Open folder

⌘O, "+ Add workspace" and "Choose folder" open one dialog for adding a workspace on any host. It is the jump menu's card (620px, hung from the top, same scrim, rows and key-hint footer), keyboard-first:
- **Host first.** A strip across the top, "Open a folder on" then a segmented control of every host in the top bar's order (remote hosts, then this Mac), preselected to the host in view. A host that isn't connected keeps its segment with its state in `text-subtle` ("· reconnecting"); choosing it shows the sidebar's sentence for that state instead of a list, never an error. ⌃⇥ / ⌃⇧⇥ cycle hosts.
- **Then a folder, browsed on that host's own daemon** (`files.listDir`), so remote and local work the same. The field is a mono path starting at `~/`; what follows the last `/` filters the folders listed (prefix matches first, a dot-folder's name counted without its dot). Every folder is listed, dot-folders included, after the others at the same rank: the user may be there to debug one. The list's heading is the folder being browsed; its first row is "Open ~/code" when nothing is typed after the `/`, then its folders. ↵ steps into a folder (⇥ too, like a shell), ↵ on "Open …" or ⌘↵ on any folder adds it, ⌘↑ goes up. A folder that is already a workspace says "workspace" and opening it selects it (or shows it again if hidden).
- **Recent folders** (the last five opened per host, this window only) head the list while the field is untouched. On this Mac a last group offers "Choose in Finder…", the native picker.
- **Failures stay inline**, one `caption` line in words: "No folder at ~/x", "Can't read /root", or the daemon's refusal. Opening selects the new workspace; from New session it moves the session there instead.

### Settings
Settings replaces the three zones inside the one main window (no separate window); ⌘, (Polaris → Settings…), the gear at the right of the sidebar's footer and the K menu ("Settings", "Settings: Appearance"…) open it, and esc returns to where you were. Mockups: Settings page, S1 Harnesses (dark), S2 Usage (dark), S3 Appearance (light), S4 Hosts (dark), S5 GitHub accounts (dark, proposed), S6 Add GitHub account (light, proposed), S7 Reviewer (dark, proposed).
- **Layout.** A 264px `surface-sunken` nav ("Back to orchestrate" with an esc keycap, the `title` "Settings", sections General (Appearance, Sessions) / Agents (Harnesses, Usage) / Machines (Hosts, Attachments), About Polaris with the flat mark and version at the foot) and one centred 680px column on `bg`. The page title is `title`, never `display`; one `body` line in `text-subtle` says what the page controls.
- **Groups, not cards.** Settings sit in hairline-bordered groups at the `card` radius with hairline row dividers; a sunken footer strip holds secondary defaults. Rows keep fixed lanes (name, version or value, state, trailing action) so columns align across rows.
- **Sessions.** Under General, after Appearance: how new Agent Sessions start and what happens around them, all on this Mac. Four groups. New sessions: "Start on a new worktree" (off; they work in the workspace directory, and each can still choose on New session) and "Branch prefix", a mono field ("polaris/"; empty allowed) whose caption shows a resulting branch; a prefix git wouldn't take gets the failed hairline and isn't saved. While sessions run: "Open output on a turn's first edit" (on) and "Notify when a session needs you" (on; the star and badge still count). Working verbs: the list the Working strip rotates through, as removable chips (a list of one can't lose its last), an add field (↵ adds; blanks and duplicates are ignored, at most 50), and a sunken footer saying Claude Code sessions use `spinnerVerbs` from Claude Code's settings first, with "Reset to the built-in verbs" once the list was edited. Archive: "Delete merged branches on archive" (off; unmerged branches are never deleted). A last `caption` line points to Harnesses for Model, effort and permissions, which stay per Harness in its footer strip.
- **Harnesses (S1).** One group per Harness: a 40px Harness tile with its still dither, name, one caption line on how Polaris drives it, and "Ready on N of M hosts". One row per host: version (mono), availability (ready with its sign-in kind, needs sign-in, needs a newer version, not installed) in neutral glyphs and text, never a signal colour, and at most one action ("Sign in in terminal", or "Open setup guide" for a Harness that is missing or too old). A version at or above the Harness's minimum but below the one its driver was tested with is ready, with a quiet `caption` after the status in `text-subtle`: "older than tested (2.1.283)". It never takes a signal colour and never adds an action (no update button); the Harness picker, Settings → Hosts and the first-run footer ("Claude Code 2.1.272, older than tested (2.1.283)") say it the same way. Polaris never installs or updates a Harness: the setup guide is the catalogue's docs link. Sign-in always opens the Harness's own terminal; Polaris never shows a key field (ADR 0001). The footer strip sets what new sessions start with: model, effort, permissions. A Harness that is ready everywhere collapses to its header.
- **Usage (S2).** Plan limits first: one row per Harness with the plan, freshness ("live" or "as of 40m ago") and each window as a pixel-cell meter of what's left, counting down like the Harnesses' own usage screens: 40 discrete cells, 4×10px with 1px gaps (199px, drawn crisp so the gaps never blur), filled cells in the Harness hue, empty cells as faint tracks (white 7% dark, black 6% light), emptying as the window is used; then "84% left" (rounded down; a sliver reads "<1% left", and a meter with any share left or used keeps one cell filled or empty to agree) and the reset time ("Resets in 3h 48m", "Resets Mon 23:00"). Near a limit the words change, never the colour ("8% left", "Near the limit · resets …"). Windows sit beside the Harness in 199px lanes and wrap to another line rather than clip (Claude's 5-hour, Weekly and "Weekly · Fable": two, then one under). The picker's hint counts down too ("5-hour 58% left · resets in 2h"). **Forecast** (after CodexBar): the meter carries a pace marker, the cell where the fill would end if the window were used evenly, drawn as one of the cells in `text-strong`, a pixel taller each way (never a signal colour; fill past it is in reserve, short of it in deficit). Under the reset line, in `caption` `text-subtle`: "10% in reserve · Lasts until reset", "12% in deficit · Runs out in 2d 22h" or "On pace · Lasts until reset" (within 2 points; on pace never claims a run-out), projected at the window's own rate since it opened; and on the whole-plan weekly, once the Daemon has seen three finished 5-hour windows, "About 2.6 full 5-hour windows left · 23 until reset". Nothing is said when it isn't well-founded: no percentage or reset, the limit reached, and no projection in the first 5% of a window (just the pace). The picker's hint adds the short form: "runs out in 1h 30m", else the pace ("10% in reserve", "on pace"). Then tokens: a 7 / 30 / 90 days segmented control, a "Split by Polaris sessions" switch (on by default only when at least 1% of the tokens ran in Polaris sessions, so a Host used mostly outside Polaris draws its bars in full Harness hue; the share reads "<1%" when it rounds to zero without being zero), three `display` figures in one row, each with a `caption` (Paper S2, 6R2-1): tokens ("13.2B", "tokens on 4 hosts"), cost ("~$7,526.65", "API-equivalent · estimated"; no "~" and "Reported by harnesses" when the Harnesses report it; "· some models unpriced" appended when some Model had no price) and share ("0%", "in Polaris sessions"). Then a stacked daily bar chart in Harness hues with usage outside Polaris at ~32% of the hue. Hovering a day, or focusing the chart and moving with ← → Home End, shows a tooltip above the chart (no layout shift; it slides with the day so it never leaves the chart): the day ("Today", "Sep 29"), one row per Model (8px hue square, name, tokens, cost) and a hairline-topped Total. Estimated costs carry "~", reported costs don't, and a Model nothing could price reads "no price". The tooltip is the menu surface (`surface-raised`, hairline, `control` radius, float shadow), in `caption`; and a by-model table where estimated costs carry a leading "~" and Harness-reported costs do not.
- **Appearance (S3).** Theme is three cards previewed with the real scenes: Night (dark), Dawn (light) and Match macOS (split). The density slider has three stops and a live session-row preview beside it; text size is its own slider; code font, colourblind-safe diffs (with a +/− swatch) and Reduce motion follow as rows.
- **Editor.** Under General, after Sessions: "Vim mode" (off) with a caption naming the commands and that Polaris shortcuts keep working in every mode, and "Autosave after a short pause" (off), whose caption says unsaved edits stay on this Mac either way and a save never overwrites a newer version on disk.
- **Hosts (S4).** A table of hosts (name, ssh alias in mono, workspace count, daemon version, Connection State, overflow menu). Connected is a filled `text-subtle` dot with latency; Reconnecting dims the row to ~55% with a hollow dot and elapsed time; Offline is a dashed dot with "last seen"; Needs Attention expands inline under its row with what happened, the evidence in a sunken well, and at most one fix. A changed host key only offers to copy the command. "Add a host" is the page's one primary button. A row opened because something needs the user shows only that (the approval card or the one reason card) and stays open afterwards to say what the install or upgrade did; its settings (name, agent forwarding, off by default, and the remote command) show only when the user opens the row. "Add a host" opens inline under the table: `~/.ssh/config` aliases as a list (wildcards left out), a name, an optional mark and the forwarding switch. Install progress is Polaris's own work, so it is the Starlight dither and the step in words ("Copying the build over SSH and checking its SHA-256"), never a guessed byte bar. The local host row carries "Use this Mac as a host" instead of remove.
- **Hosts · daemon updates (no mockup).** This Mac is the table's first row; each row's caption adds the platform ("ssh studio · Linux arm64"), and the Daemon lane shows the installed version. Under the row's main line, indented to the name, one `caption` line says where its daemon update is: "Update available · 0.4.1 → 0.5.0" with one secondary small "Update" (disabled with "Updates once <host> is connected" while it isn't); the work as the still Starlight dither with the step in words ("Checking", "Copying polaris 0.5.0 · 7.3 of 18.6 MB", "Switching to 0.5.0; agent sessions keep going"), plus a 120px 2px bar in `text-subtle` only while real streamed bytes are counted (never a guessed bar); "Updated to 0.5.0 · 3m ago" with the pixel check for a day; a host with its own choice says so ("Updates its daemon only when you ask"). A failed update is a reason card in the row, like Needs Attention: what happened, that the old daemon still runs, the evidence or command in a sunken well, Retry and at most one more (Copy command, Open in terminal); a connection's own card wins over it. "Keep daemons up to date" is a switch in the table's sunken foot with its caption (upgrades on connect, keeps working agent sessions, never installs without approval); each host overrides it from its row menu's "Daemon updates" radio group (Use the app setting (on), Always keep up to date, Only when I ask) or a select in its opened settings. Notices about an old daemon elsewhere (the `/` menu, the risk column) link here with "Update daemon".
- **Attachments.** Under Machines, after Hosts. One section per host (each keeps its own settings, ENG-180): the host's name as the heading, then a group. The first row is "Delete attachments", the host's default: when the session is archived (the default), after 1, 7, 30 or 90 days, or never, until cleared. Then one row per workspace on that host, its name and what it has staged ("94 B in 2 files", "Nothing staged"), with a select whose first choice is "Default · …". The sunken footer strip says what the host holds and offers "Clear now" (danger), which asks once more in place ("Cancel", "Delete 2 files") before deleting. A host that isn't connected, or whose daemon predates it, gets one caption line instead of the group.
- **Setting rows.** A setting's name is 13/400 `text-default` (Paper S7), its caption 12 `text-subtle`; rows, override rows and footer strips pad by the density gap, so every Settings page follows Calm, Balanced and Compact.
- **Reviewer (S7).** First in the Review section. A group headed by the Starlight reviewer tile ("Reviews with Codex · GPT-6.1-Sol · High", "For every change, whichever harness made it · read-only"; in automatic mode the caption names the fallback chain and wraps rather than truncating; "Ready on N of M hosts"), then Harness, Model and Effort selects (efforts capitalised), then one row per host in S1's lanes and neutral glyphs, with its review checkout count in `text-subtle`. A host where the reviewer can't run says what its risk summaries do instead ("run rules only") with S1's single action. The reviewer settings live on each host; a change here is written to every connected host. Workspace overrides follow S5's pattern: a sunken strip counting them ("1 workspace overrides the reviewer", one example) with "Edit overrides" opening the list inline beneath it (rule: overrides are edited in place, never in a separate workspace settings page). "When it runs": switches for pull requests on open and agent sessions on open or accept, and "Ask first for large changes" (default over 2,000 changed lines, or Never: rules run, the reviewer waits for "Run reviewer"). "What it checks against": Secrets (always on; critical unless a low-confidence generic match, which is medium), Dangerous patterns (the built-in pack, always on), Review instructions (`.polaris/review.md` and the private host file), and a caption that the reviewer's tokens count in Usage with "Open usage". Later (M6, with Risk memory learning): Risk memory counts with Show all, the proposals-waiting row, a switch for dangerous patterns, and the 7-day reviews-and-tokens figure.
- **GitHub accounts (S5, S6).** Under a Review section (Reviewer, GitHub accounts). Accounts as a group, rows on the session-row token: avatar on the harness-tile token, login, "Default" badge on the first (routing order; "Make default" moves an account first), what it covers, "signed in 3 weeks ago" in `text-subtle`; a revoked token reads "Signed out · GitHub refused its token 2 days ago" with "Sign in again", neutral. Then "Account per owner": owner, its workspaces, and an account select; an unmapped owner shows a dashed "Choose account" in `text-default` caption type; an owner whose org blocks Polaris says so under its row with one action, "Get access", whose menu holds Request access, Sign in with SSO and Check again; "Everyone else" uses the default. A sunken strip counts workspace overrides with one example, and "Edit overrides" edits them inline beneath it. "Add account" opens inline (S6): the device code large in mono, Copy code and "Open github.com/login/device" (28px buttons), "Waiting for GitHub" with the expiry in tabular figures, then a caption that GitHub asks for `repo` (full read and write to every repository the account reaches; GitHub has no read-only scope for private repositories) and `read:org`, and one on adding a second account while signed in to another on github.com. The card's padding follows density.
- **GitHub Enterprise (no mockup yet).** Below the owners, collapsed to one ghost "Add a GitHub Enterprise server" until there is one. Then a "GitHub Enterprise" group: each server's domain, its account count and OAuth App client ID in a caption, "Add account" (the same inline device flow, its copy naming the server), and a menu with "Manage Polaris on <server>" and removal (the server and its accounts, from this Mac). Adding is inline: Server (domain, URL or API URL) and Client ID, with a caption on who provides the client ID. Copy says "server", never "host": a Host runs a Daemon (CONTEXT.md). Accounts on a server lead their caption with its domain.
- **Harness hue in Settings.** Beyond tiles and dither, a Harness hue may fill plan-limit meter cells, chart series and 8px legend squares, since those are identity. It still never colours text, buttons or selection.

### Onboarding

One brand moment, then the real shell; never a wizard. First launch shows a full-bleed scene (night or dawn) with the horizontal lockup, the tagline, one line saying what Polaris drives, and a single "Get started" button in the brand-moment size (see Buttons). A footer states what was found on this Mac (Harness versions, hosts in `~/.ssh/config`). After that, the app opens to the empty Orchestrator, and returns to it whenever no host has a workspace. The stage holds a clearing, the headline "Where does your code live?", and a `surface-raised` setup card with three rows: add a workspace (primary; "Choose folder ⌘O" opens the Open folder dialog on that host, this Mac or remote), connect a host (optional), and start a session. Starting a session never waits for a workspace: with none on the host, the row, New session and ⌘N register the host's home directory as the workspace "home" and open New session in it, as a local shell would. The row is locked only while the host isn't connected. Adding a host uses the same inline components on day 1 and day 60. The first install shows platform, version, SHA-256 and install path in a sunken well, with "Approve and install" and "Not now". Each needs-attention reason (`host-key-unknown`, `host-key-changed`, `auth-failed`, `daemon-not-running`, `protocol-mismatch`) gets an inline card: what happened, the command or stderr line in a well, and at most one fix. A changed host key never gets a one-click fix. Mockups: Onboarding page, O1–O4.

### Empty states

Three tiers. **Stage**: the whole main area is empty (first run, a workspace with no sessions, a host with no workspaces). It uses the pixel scene with a clearing, as in New session. **Pane**: an inbox, the Review queue, a risk summary with no findings, the Editor with no file open, or an empty Constellation. It uses a 48px watercolour tile with a pixel icon, one `heading-sm` sentence, one `caption` line of fact, and at most one secondary action. There is no scene and no signal colour: "Nothing needs you" never uses the needs-you hue. A risk summary with no findings says what ran and what the user hasn't opened; it never implies the change is safe. **Inline**: a section or menu with nothing in it gets one `caption` line under its header ("None in polaris"). Mockups: Empty states page, X1. In the app: a host with no workspaces is the first-run stage ("Where does your code live?", 57Q-1); a workspace with no sessions is a stage headed "Nothing is running here yet" with a setup card (start a session, open a terminal); a workspace whose sessions aren't open is a pane ("No agent session open", "3 sessions in polaris · K to jump", New session); modes not built yet are panes too.

### Output

The Orchestrator's lanes, left to right: sidebar (264px), Intent (the rest, never under 320px), Output. Output is collapsed by default, so the conversation gets the room.

- **Rail (collapsed).** 240px on `surface-sunken`, no divider of its own (Intent's hairline separates it). A 44px header with a show chevron (⌘⌥B) and "Output" in `label`, then fact rows at the row height in fixed lanes (a 16px icon slot, then the value): the session's state glyph and state, the Host, the cwd in `code-inline` (truncated from the start, so the folder name stays), the branch in `code-inline` ("Not a git repository" in `caption` `text-subtle` when there is none), and the change count from git status ("2 changes", "No changes"), which opens the panel. The Terminal strip stays at its foot; toasts inset past it.
- **Panel (open).** Changes for the chosen Turn, as before, with a hide chevron at the header's end. Default width 80% of what the old fixed 448px Intent left (about 450px in a 1280px window); resizable from its left edge (an 8px hit area, ← → by 16px, double-click resets), never under 360px nor leaving Intent under 320px. The width is one per window and persists.
- **When it opens.** The chevron, the change count, ⌘⌥B, or showing the terminal drawer (which lives in the panel). Until the user opens or closes it themselves, the session's first edit in a Turn (a file change item, or the Turn's diff gaining a file) opens it too; after that, their choice holds. It only collapses on a user action; hiding it hides the terminal drawer too (its terminals keep running).
- **Remembered.** Open or closed is kept per session across restarts (the 500 most recently changed); the width is one per window.
- **Motion.** Opening slides the panel in from the rail's edge on `transform`, 200ms ease-out; Intent reflows once, not per frame. Collapsing is instant. Reduce Motion makes opening instant.
- **Live.** The diff of a Turn still in flight and the rail's facts follow the files as they change (`files.watch` on the session's cwd, settled over 250ms); no reload needed, on this Mac or a remote Host.

### Terminal

A drawer of Daemon terminals per Workspace, docked under Output (under the stage when no session is open), so the conversation keeps its full height. Hidden, it is a 28px strip ("Terminal ⌃`"); shown, a hairline-topped drawer (default 280px, resizable from its top edge, never under 120px or leaving less than that above) with a 36px header: tabs in `label` type (selected: `fill-selected`, `text-strong`), the cwd in `code-inline` `text-subtle`, and a hide control. ⌃` toggles it; showing an empty drawer opens the Workspace's shell. Tabs are the Workspace's shell and one per session handed off to its Harness's terminal UI.

- **Type.** SF Mono 12/16, weights 400 and 500 only; a Nerd Font, when installed, fills in prompt glyphs. Cursor is a bar that doesn't blink.
- **Colour.** Ground `bg`, text `text-default`, cursor `text-strong`, selection `text-strong` at 22%. The ANSI palette is moonlit (rule/syntax-is-moonlit): red and green are the `diff-*-text` hues mixed toward the foreground, yellow, blue and cyan are the syntax string, keyword and type tokens, magenta a mix of keyword and string. It follows the theme live.
- **Ending.** When the process exits, a 36px sunken bar under the terminal says so in `caption` ("Process exited with code 2"; with no code, "This terminal ended. The daemon restarted or the process was stopped") with one secondary action, "Open a new terminal here" (same cwd), or "Run again" on a hand-off tab. The output stays readable above it.
- **In Terminal.** "Open in terminal" is in the session menu. While the session is In Terminal, a sunken `row`-radius bar sits above the composer: the pixel terminal icon in `text-subtle`, "In terminal", one `caption` line ("Polaris follows along; take it back to send a turn"), a ghost "Show terminal" and "Take back", which returns the session and closes its tab.
- **Performance.** xterm.js on its WebGL renderer, loaded with the first terminal shown. Hidden terminals stay alive (up to four) so switching back is instant; beyond that the oldest is dropped and reattaching replays the Daemon's scrollback.

### Attachments in the composer

Pasted and dropped files stage on the session's Host straight away and show as source chips: a 16px thumbnail for images, the name in mono, the size in `text-subtle`, removable. While uploads run, one `caption` line says so ("Attaching 2 files…"). Dragging files over the composer shows a quiet hint over it (dashed hairline, `surface-raised` at 90%): "Drop to attach", and "Hold ⌥ to copy into the workspace instead". ⌥-drop copies the file into the session's directory on the Host and says so in a Polaris toast ("Copied notes.txt · Into ~/code/polaris"); it never overwrites.

### Skills and Slash Commands in the composer

The composer is a plain-text editor (Lexical) where the Harness's **Skills** and **Slash Commands** (CONTEXT.md) become chips (rule/commands-are-chips).

- **The list.** Typing `/` at the start of the message (or `$` anywhere, for a Codex Skill) opens a floating list just above the composer, left-aligned with it, up to 560px wide and 320px tall: `surface-raised`, `card` radius, hairline and the float shadow, fading in over 160ms. Rows are two lines: a 16px icon (Skills: a file with a sparkle; commands: a bolt) in `text-subtle`, the name with its sigil in `label` medium, a faint argument hint (`<optional instructions>`) and, trailing in `micro`, where it comes from (`project`, `user`, the plugin's name; nothing for built-in ones); then its description in one truncated `caption` line. Skills come first, then commands, each under a `caption` header when both are shown. Typing filters it: prefixes of the name, then of a part (`codex:re` → `codex:review`), then from two letters on anywhere inside; within each of those the user's own **frecency** (how often and how lately they picked it, Sightline's Find scoring) breaks ties, so match quality always wins over habit. A bare `/` leads with up to five frecent picks under a "Recent" header, then Skills and commands as usual. Frecency is kept on this device only, per Host, Workspace and Harness, bounded (120 picks per table, 40 tables). It shows at most 50 rows with "N more · keep typing to narrow" under them. While the Host is still reading the list: one `caption` line, "Reading skills and commands…". Nothing matching closes it; a Harness that lists nothing never opens it. **A Host whose Daemon is too old to list them** never shows an empty list: in the list's place, one `caption` line, "Skills need a newer daemon on Mac Studio", with a secondary "Upgrade daemon ↵" that runs that Host's upgrade (as Settings → Hosts does). It follows the upgrade: "Upgrading the daemon on Mac Studio…", "Couldn't upgrade the daemon on Mac Studio: …" with "Try again", then the list once the Host reconnects. Any Host's upgrade says so in a Polaris toast, "Daemon upgraded · This Mac · 0.0.0-dev.399 → 0.0.0-dev.412".
- **Keyboard-first.** The editor keeps focus: ↑ ↓ move the highlight (`fill-selected`), ↵ or ⇥ pick, esc closes the list for that word (a second esc stops a Working Turn as before). A click picks too; hovering moves the highlight.
- **The chip.** Picking one replaces the typed word with a chip: its name in `label` medium `text-strong` on `fill-selected`, `control` radius, 1px by 5px padding, with its kind's icon in `text-subtle` standing in for the sigil. It sits inline in the text and never changes the line height. The caret and Backspace take it whole; copying it gives its sigil and name. A listed name typed through with a space after it (`/compact `) becomes a chip too, as does a restored draft's. Chips are neutral: the Harness hue stays in its three places.
- **What runs.** Each entry carries how it runs (`harness.commands`): sent as text in the Turn (most Skills and commands; a Codex custom prompt goes expanded), turned by the driver into the Harness's own call (Codex `/compact`, `/review`; OpenCode's commands), or done by Polaris itself, in which case picking it leaves no chip and no text: `/model` and `/effort` open the Model menu, `/clear` and `/new` start a new session, `/diff` shows Output, `/usage` and `/cost` open Settings → Usage. Commands only a Harness's terminal UI can run (themes, `/config`, `/mcp`, `/heapdump`…) are never listed. The per-Harness table is in `apps/daemon/src/harness/README.md` and each driver's README.

| Harness | Listed from | Sent as text | Run by the driver | Polaris does it |
|---|---|---|---|---|
| Claude Code | the Agent SDK's `supportedCommands()` in the session's directory | Skills, custom and plugin commands, `/compact`, `/init`, `/review`, `/security-review`, `/pr-comments` | none | `/clear` `/new`, `/model` `/effort`, `/usage` `/cost` |
| Codex | app-server `skills/list`, `~/.codex/prompts` | `$skill`, `/prompts:name` (expanded) | `/compact`, `/review` | `/model`, `/new`, `/diff` |
| OpenCode | its server's `/command` | none | every listed command (`session/command`) | none |
| ACP (Gemini, Copilot) | the agent's `available_commands_update` | every listed command | none | none |

### Attachments in the conversation

What a message carried sits above its bubble, right-aligned like it, in the order attached: images as thumbnails in `row`-radius sunken boxes with a hairline (one image fits 240×180, several fit 112×112 each, wrapping), then other files as source chips (name in mono, size). Each thumbnail's box is reserved from the size the Host recorded when it was staged, so nothing moves when the image arrives; an image staged before sizes were recorded takes a square and is cropped to it. While a thumbnail loads, the composer's own small thumbnail stands in, faded and softened; one the Host can no longer read says "No preview". A click opens the image in a dialog (an opaque `surface-raised` card: the name in mono, its pixel size and file size in `caption`, the image on `surface-sunken`); esc closes it. The caption under the bubble is only the Model and effort ("Opus 5 · high"); file names never go there. Pending steers and follow-ups show their attachments the same way.

### Needs You inbox

The sidebar's second view, across all machines. Each waiting session is a `card`-radius card with its Harness tile, title, and "Host · Workspace · age". Approvals show the command in a sunken code well and Approve / Always here / Deny. Questions show the question; the answer happens in the conversation, where the question renders as a card with a `needs-you` watercolour header strip and numbered answer rows (the recommended one filled). Failed and In Terminal sessions follow under "Also waiting on you" as compact one-line cards with a single action (Retry, Take back).

### Icons

Nucleo UI outline, 1px stroke, 16px, in `text-subtle` (or `text-strong` when selected), for all chrome. Nucleo pixel icons are only for Polaris-owned concepts (Session States, Harnesses, toast types) and always sit on the pixel grid. Never mix icon families within a component.

**Licence.** The icons are Nucleo (UI outline and pixel), vendored into the repo under Nucleo's licence (at most 100 icons, with its copyright notice). They are excluded from Polaris's Apache-2.0 licence and listed as such in `ATTRIBUTION.md`. The decision may be revisited (original icons, or a permissively licensed set) before the repo goes public.

**Feature marks.** A Polaris feature may get its own 16×16 pixel mark, drawn on the same grid as the north star and generated by `gen_dither.py`. The Constellation mark (`design/assets/icons/px-constellation-*.svg`) is three stars (a 5px sparkle, two 3px crosses and one lone pixel) joined by dotted lines, in Starlight because the graph is Polaris's own work. Feature marks label the feature on the marketing site, in docs and at the Constellation tab. They never stand in for a Session State.

### Motion

Quiet. Standard transitions are 120ms (hover, press), 160ms (small reveals), and 200ms (panels, toasts), all ease-out. No bounce, springs, or overshoot (Output's slide-in is a 200ms ease-out, not a spring). Reduce Motion drops all transitions to instant fades, stills the dither, and stills the scenes.

### Performance

- Animate `transform` and `opacity` only. Anything that triggers layout or paint per frame (width, height, top, box-shadow, blur radius) does not animate.
- Dialogs and the jump menu are opaque `surface-raised` cards at every moment, their input row included: the card scales in from 98% over 200ms and closes at once, and only the scrim fades. Nothing behind ever shows through a dialog, even mid-animation.
- Springs are fine for panels and toasts when they drive `transform`. The Working dither steps a sprite strip by `transform`.
- Long lists and diffs are virtualised; nothing animates on scroll.

### Constellation (DAG)

A native take on herdr-dagr (ENG-169), specified by the Constellations v1 map (ENG-232; events ENG-236, tools ENG-237, a worker's life ENG-238). Terms are in `CONTEXT.md`: a Constellation belongs to one **Lead** Agent Session and holds Tasks; each try at a Task is an Attempt carried by a worker Agent Session; a worker's **Claim** puts its Attempt in review until the Lead or the user accepts it or sends it back; a Task may declare an **Area**; Gates are fan-in Tasks the Lead carries itself; Futures are declared but not started (a worker can propose one); Subagents nest under their session. Mockups: Paper page "C1 · Constellation per Lead", C1–C9 (artboard 7 on the Orchestrator page is the earlier per-Workspace baseline).

- **Where.** One Constellation tab per Lead, in that Lead session's output pane, next to its conversation. A Workspace can run several Constellations at once, each under its own Lead. There are no terminal panes for workers: peeking into one is the focus swap below. With a worker focused, the tab bar carries "Message lead (M)".
- **Header.** The Constellation mark, its name, "led by this session · running" (states: planning, running, paused, completed, archived), a **progress strip** of one 10×4px segment per Task in its state colour (dashed for Futures; past about 40 Tasks it becomes one proportional bar), and the next thing that needs you as a needs-you chip ("B5 stopped without claiming", tab to jump).
- **Rows, not a canvas.** A rail list in the spirit of `git log --graph`: the trunk, collapsible groups with trailing counts ("1 needs you · 2 in review · 2 working", "3 done" in `accepted`), Tasks, and the Subagents under their Attempt. Fixed lanes: rail (60px), id in `code-inline`, title, actor (harness · model, "lead" for a Gate, "codex · on devbox" for a remote worker), state. A row is one line, plus at most one or two short `caption` lines when they carry state: never prose (rule/no-dashboard-clutter).
- **State colour (rule/constellation-colour).** The graph reads at a glance, as dagr does. Working keeps the Harness dither on its glyph, as in the baseline, and its id and words stay neutral. Done with evidence is `accepted` (a yellow-green, apart from Codex mint) on the glyph, id and state word. Needs you is `needs-you`; a failed check is `failed-text`; in review, waiting and Futures are neutral. Starlight is not used for states (rule/starlight-is-rare). Words use the `-text` variants; every colour keeps its glyph (rule/no-colour-alone).
- **Rail glyphs.** Working: the 10px Harness dither. In review: a `text-default` ring with a centre dot (dashed while the branch is not yet fetched). Needs you: the pixel hand. Accepted: a filled `accepted` dot. Waiting: a hollow `text-faint` dot. Future: a dashed dot on a dashed branch; a proposed one adds "proposed by B2" with Accept / Decline. Gate: a small square (filled `accepted` when accepted, outlined while waiting), never a diamond (that is Critical). Rail lines are white at ~14%; an accepted group's branches take `accepted` at 40%.
- **Liveness.** A working row's second line says what the worker is actually doing, from session events and never the model: the current command and how long it has run (`bun run bench · 4m`), or what it waits on ("waiting on bench (held by B2) · 2m"), then context % and queued input in `text-faint`.
- **Claims.** The Lead reviews Claims by default. A Claim row says "in review", and its second line is the Claim at a glance: head SHA, each check as ✓ (`accepted`) or ✗ (`failed-text`), "1 not done", questions in `needs-you-text`. Accept / Send back live in the row's menu (⋯ or right-click: Accept… a, Send back… s, Open in Review, Focus; "The lead is reviewing this claim"). They become buttons only when the Constellation is paused or the Lead hands the Claim up; a handed-up Claim's row says "handed to you" in `needs-you-text`. A remote worker's Claim waiting for its branch reads "review · branch not yet fetched" until the Desktop App carries the bundle back.
- **Gates.** Inputs inline as small dots in each input's state colour (a ring for in review, the Harness hue for working), an arrow, the title, actor "lead". The Gate is the Lead's own Attempt; once accepted, its second line lists the merged head and its receipts: ✓ verified (a receipt pointing at a Daemon-recorded tool call) or ○ reported (text only). An unaccepted Gate says "waits B1–B5".
- **Areas.** A Task whose Area overlaps a working Attempt's gets a neutral line: the overlap icon, "Area overlaps B2" and the glob. It warns the Lead; it is not a needs-you.
- **Silent ends.** A worker that ends without a Claim is nudged once; if it ends silently again, the row turns needs you with "stopped without claiming · nudged once" and it joins Needs you.
- **Polaris-authored cards.** What Polaris puts into a Turn is a `row`-radius card on `surface-raised` with the Constellation mark in its header, never the user's prompt bubble. A worker's **brief** card shows "Brief from {lead}", the Task id, Area, branch and base, and the accepted deps (an `accepted` dot), then the Lead's text; later in the session it folds to one line. A Lead's **digest** card ("Constellations v1 · 3 updates for the lead · 18:56") lists one row per settle or question, each with its state glyph and coloured id.
- **Focus swap into a worker.** Selecting a row swaps the middle column to that worker's live session, as before: a breadcrumb back to the Lead ("Constellations v1 lead › B · Spec and tools › B1"), the title with its Harness and "In review · attempt 1", the brief card, its transcript, and a composer labelled "Steer B1 directly · reported to the lead": every direct steer is journaled to the Lead. The graph stays put; the selected row takes a translucent fill. There is no detail card.
- **The Claim card.** When the worker has claimed, its last Turn ends with the Claim as a `row`-radius well: header (state ring, "Claim", "in review", head and commit count in mono), each check as a receipt line (✓/✗, the command, "verified · exit 0"), then Not done, Question (`needs-you-text`), Decided, and Area. Its footer says "The lead is reviewing" with Open in Review ↗ and the ⋯ menu.
- **Reviewing a Claim** (paused, or handed up: "The lead handed this claim to you" in a `needs-you` strip). Accept / Send back is a segmented control inside the card. Accept asks for the merged head (it must match the claimed head) and receipts, and computes the tier. Send back takes a reason, Same session (a new Turn with the reason) or Fresh session (same worktree, the brief and this claim), and Merge conflict (names the base to merge first); the button names the worker ("Send back to B1"), and "the lead is told". "Open B1 in Review" opens the worker's Agent Session in Review.
- **From Review.** A worker's Agent Session in Review shows "worker of {lead} · claim in review at {head}". Its primary is **Approve** (records the user's verdict; the Lead merges and accepts); the split menu adds **Send to @B1** (the feedback becomes a send-back; the Lead is told) and **Accept and merge myself** (merges the claimed head in the user's checkout and accepts with their receipts).
- **Sidebar.** Each Lead is a session row with the Constellation mark and "Lead · 7 workers" on its second line; its workers nest under it on a hairline rail as compact rows (16px state glyph, mono id, short title, state or age), needs-you first, accepted workers folded into one "A1, A2 done · show" line. A collapsed Lead shows "▸ 3 workers · 1 needs you". The sidebar footer counts constellations.
- **Needs you.** Worker attention joins the inbox, grouped under each Lead's name with the Constellation mark: a question from a Claim (Answer), "stopped without claiming" (Open, Restart fresh), a blocked approval (Approve / Always here / Deny), and a worker near its context limit (a neutral meter and the percentage, Compact / Fresh session; rule/context-is-quiet). Progress never reaches Needs you or the Lead; only settles and questions do.
- **Review's queue.** Workers' Claims in review are their own group, "Workers' claims", above "Agent sessions ready" (each row "B1 · Quint properties", "Claim · Constellations v1"); worker sessions never appear as ready sessions, since the Lead, not the session Accept, takes their work. Beside the worker action sits a neutral "Attempt N" chip. Once the user approves, the primary reads "Approved" (disabled) and the caption "claim at 3f9c2e1 approved by you · the lead merges"; a handed-up Claim's caption says "handed to you", and its Needs you card reads "The lead handed B1's claim to you" with the Lead's reason and Review B1.
- **Settings → Constellations** (Agents group): the workers' Harness · Model · Effort per role (Backend and systems; UI and design) as the Reviewer's three chips, prefilled with the spec's defaults, Reset per role. They are the user's, kept on this Mac and written to every connected Host (a Lead reads its own Host's copy), with one caption line per kind: "Saved on Mac Studio and devbox.", "Couldn't save on …; Polaris tries again when it reconnects.", "… runs a daemon without these defaults; leads there use the built-in ones." **Settings → Hosts**, on an open connected host: "Workers at once" (a − / + stepper, "automatic" or "Automatic (4)", "2 of 4 working · 1 waiting for a slot"; − stops at the working count) and Resources (mono name, "one at a time", "held by B2 · 1 waiting", the holder's command and age; past its hold limit "past its 30m limit" with Release; Remove only when free; an inline Add). All neutral: no signal colour.
- **Usage → By constellation**: a table under By model, one row per Constellation (mark, name, Lead tokens, workers' tokens, cost, time), opening to its Tasks' tokens and cost. Exact per response from the Lead's Host (`constellation.stats`), with "Since each started, per response, from its lead's host." under it, and one caption line per gap (remote workers joined by the hour, a Host without stats estimated by the hour).
- **Waiting for a slot.** A worker queued for its Host's worker slot shows "waiting · 2m" (neutral, the hollow waiting glyph; hover: "Waiting for a slot on devbox · 2m") in the sidebar, and "waiting for a slot on devbox" in its Review caption. It is not a needs-you.
- **Handover.** Handing the Constellation to a new Lead leaves a record at the top of the trunk: a faint dot, "Handed to a new lead at 18:20" and "Summary ›". Summary opens as a focus swap (breadcrumb "{lead} › {constellation} › Handover", "previous lead → this session", "atomic · rev 37"): the previous Lead's prose summary (the `/handoff` shape) in a card, then the structured part from the event log: the graph at handover as a strip and counts, the Attempts in flight, open questions (`needs-you-text`), messages not yet delivered and where they went, and "Open the previous lead ↗" (archived, read-only).
- **Empty.** A Constellation with no Tasks is a Pane empty state (see Empty states): the Constellation mark on a 48px tile, "No tasks yet", "The lead is drafting a plan. Tasks appear here as it adds them.", and one secondary action, "Add a task". The header says "planning" and has no strip.
- **Large Constellations (100+ Tasks).** Filter chips sit under the header (All 128 · Needs you · In review · Working · Done, each with its count in its state colour) with "Filter tasks /". Groups fold by default, each with a 120×4px proportional bar and its counts; a group with something that needs you opens itself, and inside an open group the waiting Tasks fold into one "▸ 6 waiting · C1, C7, C9–C12" line. Rows drop to one line. The list is virtualised.
- **Subagents are nodes.** As before: nested under their parent, smaller glyph, "subagent" as actor, focusable.
- **Keys.** The foot row: move, focus, fold, next that needs you, a accept / s send back (from the row menu), m message lead.
- **Narrow Output.** A Lead's Output opens on its own unless the user closed it for that session. Below about 42rem the actor lane hides first, and the header's needs-you chip wraps under the name rather than truncating; ids, titles and state words keep their lanes.

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
- **Find and replace.** CodeMirror's panel at the top of the code, on `surface-sunken` with a hairline under it, aligned to the breadcrumbs: mono fields at the `control` radius, secondary `caption` buttons, labels in sentence case ("Match case", "Regex", "Whole word"). Matches are neutral (`text-strong` at ~14%, the current one ~26%), never a signal hue.
- **Disk changes.** A file with no unsaved edits reloads in place when the disk changes (cursor and scroll kept), its changed lines lit with the `diff-added` fill that fades over 1.6s (instant under Reduce Motion). With unsaved edits, a neutral strip on `surface-sunken` under the breadcrumbs says "Changed on disk by Claude Code" (or "Changed on disk" when no agent session is known to be editing it) with Compare (ghost), Keep mine and Take theirs (secondary); Compare swaps the code for a read-only unified diff (your text against the disk, unchanged runs folded) and reads "Back to editing". The same strip says "Deleted on disk" (Close tab), "Couldn't save. {reason}" (Try again) and, on a Host whose daemon can't save, "The daemon on {host} can't save files yet" (Update daemon). It is never a signal colour.
- **Unsaved edits** stay on this Mac per Host and path and come back after a restart (the tab keeps its dot). Quitting with unsaved files asks once, natively: "Save changes to 2 files before quitting?", Save and quit / Quit / Cancel; Quit keeps them as drafts.
- **Vim mode** (Settings → Editor, off by default): the mode leads the status bar's right side in mono `text-default` (NORMAL, INSERT, VISUAL, VISUAL LINE, VISUAL BLOCK, REPLACE; the vim convention is the one place a label is in capitals); the `:` line is a mono panel at the foot of the code.
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
- Animate anything other than the Working dither in a loop, outside a pixel scene's ambient life.
- Use Starlight on buttons, links, or selection.
- Put pixel scenes or dither behind code, diffs, or Orchestrator lists.
- Use blur as glow or emphasis; glow is a dither halo. Blur only separates floating layers (see Elevation).
- Use bold or semibold weights, all caps, emoji, or exclamation marks.
- Show a Severity as colour alone, or let anything hide or dim a Critical Finding.
