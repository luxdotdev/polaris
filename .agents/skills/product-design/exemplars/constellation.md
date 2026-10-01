# Exemplar: Constellation

Status: accepted (owner, 2026-09-28: "This looks good to me, we can
commit"; name chosen the same day)
Surface: Paper, Orchestrator page, artboard 7 "Constellation · focus on a
subagent · Dark". Commits 47d5e45, bea7463.
Why exemplary: the native take on herdr-dagr (ENG-169) and the reference
for viewing any single agent, including subagents, inside a larger effort.

## Decisions worth repeating

### A rail list, not a canvas
- What: a Constellation tab in the Output pane, one per workspace. Rows in
  the style of `git log --graph`: trunk, collapsible project groups with
  counts, Tasks, and their Attempts and subagents nested; fixed lanes for
  rail, id, title, actor, and state.
- Rules exercised: rule/no-dashboard-clutter, rule/long-content-survives.
- Evidence: owner's herdr screenshot of dagr beside the conversation;
  artboard 7.
- Repeat when: showing dependency structure among agent work.

### Focus swap for one agent, no detail card
- What: selecting a node swaps the middle column to that agent's live
  session (breadcrumb back to the orchestrator, the brief it received, its
  transcript and steps, a composer that steers it). The graph stays put;
  the selected row takes a translucent fill and a live second line.
- Rules exercised: rule/say-what-happened; PRODUCT.md, Operating Context.
- Evidence: owner: "The card at the bottom is not a great solution for
  this"; chose focus swap over inline expansion and a graph-first split.
- Repeat when: drilling from an overview into one agent. Reuse the
  conversation column; do not invent a new inspector.

### Glyphs reuse Session State; gates avoid the diamond
- What: dither for working (Starlight for Polaris's reviewer), hand for
  needs you, filled dot done, hollow dot waiting, dashed dot future, small
  square for a gate with its inputs as coloured dots.
- Rules exercised: rule/severity-vs-state (◆ is Critical only),
  rule/no-colour-alone.
- Evidence: artboard 7.
- Repeat when: any graph or timeline of agent work.

### Direct steering, mirrored to the orchestrator
- What: the focused agent's composer steers it directly; every direct steer
  is reported to the orchestrating session. "Message orchestrator (M)" stays
  in the tab bar.
- Rules exercised: CONTEXT.md, Constellation, Attempt.
- Evidence: owner: "it will be beneficial for the orchestrator to know all
  of the changes and steering."
- Repeat when: any control acts on a child of an orchestrated effort.

## Known flaws

- Superseded in part by the Paper page "C1 · Constellation per Lead"
  (ENG-242, proposed): one Constellation per Lead, state colours, Claims.
- No empty Constellation; long Constellations (100+ Tasks) untested for
  folding and scroll.
