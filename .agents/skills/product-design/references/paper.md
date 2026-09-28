# Making mockups in Paper

Load in Mock mode or whenever editing the Paper file. The Paper MCP guide
(`get_guide` "paper-mcp-instructions") still applies; this file records what
Polaris learned on top of it.

## File and structure

- File "Polaris — Orchestrator" (id `01M3JV1J857QNW61TGHZYR6GMZ`). Pages:
  Orchestrator, Review, Editor, Brand, Brand deck. Artboards are 1440×900
  desktop, named `<n> · <surface> · <state> · <Dark|Light>` (Editor uses
  `E1`, Review `R1`).
- Start new artboards by duplicating the nearest accepted one (artboard 5
  "Orchestrate · Elevated" for anything in the Orchestrator, E1 for the
  Editor, R1 for Review) or by cloning its title bar, workspace bar or
  machine bar, and sidebar. Never redraw chrome.
- Light artboards use the machine bar (artboards 2 and 6); dark use the
  workspace bar. Keep that pairing until it is decided otherwise.
- After duplicating, switch the title-bar mode switch (Orchestrate, Review,
  Edit) to the right mode: move the fill and `text-strong` to the new item.

## Tokens

- Paper tokens mirror DESIGN.md as `-dark`/`-light` pairs (Paper has no
  mode API). Use `var(--color-...)` or the exact hex from the pair.
- Sans is `system-ui` (SF Pro on the Mac); mono is JetBrains Mono standing
  in for SF Mono. Turn ligatures off on code text
  (`fontVariantLigatures: none`) or `<=`, `===`, `=>` render as glyphs.

## Paper behaviors that bite

- Styles do not inherit. Every text span needs its own font family, size,
  line height, and `white-space: pre` for code.
- Text nodes size to their content (`width: max-content`); a width on a
  span is ignored. Right-align line numbers by padding with spaces (" 9")
  or wrap the text in a fixed-width flex box.
- Wrapping: set `white-space: nowrap` and `flex-shrink: 0` on labels inside
  buttons, tabs, and footers, or they wrap to two lines when space is tight.
- Images are cached by path: after regenerating an asset, copy it to a new
  filename (scratchpad) before pointing a node at it.
- Geist Pixel's "Square" style cannot be set through the MCP, and changing
  text or size on a cloned wordmark resets it. Clone the existing
  "Wordmark" layers untouched; if one breaks, ask Lucas to reapply the style.
- Absolute children inside flex containers work (selection toolbars, rails).
  A translucent row fill (`#FFFFFF10`) lets absolute rail lines show through;
  an opaque one hides them.
- `update_styles` with `fill` recolours an SVG, but `stroke` on the SVG root does not: rewrite stroked icons with `write_html` (replace) when switching themes. The cached-path problem also hits the brand SVGs: the light theme needs a fresh copy of `polaris-logo-blue.svg`, or it renders an old star.
- Screenshots right after a write can miss the last change; re-screenshot
  the specific node before "fixing" something that is actually there.
- Big writes (whole code files) are fine as one call per 10 lines; generate
  the HTML with a small script (syntax colours from DESIGN.md) rather than
  by hand.

## Finish

Screenshot each changed artboard, fix in one batch, call
`finish_working_on_nodes`, then record new decisions in DESIGN.md.
