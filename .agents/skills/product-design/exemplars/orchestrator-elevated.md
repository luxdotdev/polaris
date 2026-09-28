# Exemplar: Orchestrate · Elevated

Status: accepted (owner, 2026-09-28: "The elevated orchestrate surface looks
incredible and we should go with this.")
Surface: Paper, Orchestrator page, artboard 5 "Orchestrate · Elevated ·
Dark". Related: 1 (the calmer first pass it replaced), 2 "Machine bar (11+
workspaces) · Light", 3 "K jump menu · Dark".
Why exemplary: the chosen Orchestrator direction and the source every other
artboard is cloned from; it shows the three zones, the pixel world used as
signal, and the Working state at its loudest.

## Decisions worth repeating

### Three zones: Input, Intent, Output
- What: sidebar (264px: workspace header, Sessions / Needs you segmented,
  session rows, sources as chips, "Needs you elsewhere", jump footer),
  conversation (448px), and Output with tabs (Changes, Preview, Files,
  Risk; later Constellation) taking the rest.
- Rules exercised: rule/no-dashboard-clutter; PRODUCT.md Principle 5.
- Evidence: artboard 5; commit 2f25851. Review and Editor mirror the same
  left-to-right grammar (review.md, editor.md).
- Repeat when: any view that pairs a list, a focused object, and its
  output.

### The Harness tile carries identity and state
- What: a 32px watercolour-washed tile in the Harness hue holds the Session
  State glyph (dither, hand, dot, terminal, x); the row's second line says
  what the session is doing, tinted needs-you only for Needs You.
- Rules exercised: rule/severity-vs-state, rule/needs-you-is-loudest,
  rule/say-what-happened.
- Evidence: artboard 5 "Sessions (tiles)"; DESIGN.md, Session rows.
- Repeat when: listing agent sessions anywhere (Needs You inbox, agents in
  a workspace in the Editor, Constellation rows use the glyph only).

### Lean into the pixel world, but only as signal
- What: the elevated pass added watercolour tiles, the Working strip with a
  dither halo bleeding from its corner, and a toast with a full-height
  washed tile. Neutral chrome everywhere else.
- Rules exercised: rule/colour-means-something, rule/only-working-moves.
- Evidence: owner on artboard 1: "feels a bit basic and generic... lean a
  bit harder into the design direction"; the four rule bends were accepted
  and codified (Harness hue on the Working strip and picker, halo, tiles).
- Repeat when: a surface feels generic. Add identity through tiles, dither,
  and scenes, never through extra colour on chrome.

### The Working strip replaces every spinner
- What: 34px strip on the composer: dither glyph, "Claude Code is working"
  in the Harness hue, elapsed, Stop (esc); border at ~28% Harness hue;
  placeholder "Queue a follow-up for after this turn".
- Rules exercised: rule/only-working-moves, rule/say-what-happened.
- Evidence: artboard 5 "Composer wrap (working)"; reused in E3 across the
  editor (editor.md).
- Repeat when: anything shows an agent working on something the user is
  looking at.

### Wordmark lockup in the title bar
- What: 16px flat star plus 13px Geist Pixel wordmark after the traffic
  lights, then the mode switch and the jump field.
- Rules exercised: DESIGN.md, Brand; rule/starlight-is-rare.
- Evidence: owner: "We also need the new wordmark on the top bar for the
  orchestrator - it's missing"; commit 1a178f0.
- Repeat when: every artboard; clone the title bar.

## Known flaws

- Only dark at Calm density; Balanced and Compact untested.
- Connection State of a Host is not shown in the workspace bar.
- The toast overlaps the diff; placement against real content unverified.
