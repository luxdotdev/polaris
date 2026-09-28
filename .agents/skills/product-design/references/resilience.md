# Resilience

Load for Harden, full Review, and any new surface or artboard set.

## rule/design-reachable-states
Scope: every new or materially changed surface.
Rule: design every state the product can enter, not just populated
success. For Polaris that always includes: each Session State the surface
can show (Starting, Working, Needs You, Idle, In Terminal, Dormant, Failed,
Archived), each Connection State of the Host (Connected, Reconnecting,
Needs Attention, Offline), empty and first-run, and loading.
Why: several sessions across several Hosts means some are always in an
unusual state; the unusual state is the one the user must act on.
Exceptions: none.
Source: CONTEXT.md, Session State and Connection State.
Enforcement: agent.

## rule/remote-is-normal
Scope: anything that shows or acts on a Host other than the local Mac.
Rule: remote is a first-class case: show which Host (status bar, row
caption, header path), tolerate latency (optimistic where safe, never block
typing), and render Reconnecting as the last known state dimmed, never a
modal (CONTEXT.md, Reconnecting; ENG-178 criterion 6).
Why: M1 must replace herdr across four machines, and a network drop must
not interrupt supervision.
Exceptions: destructive actions wait for Connected.
Source: ENG-178 acceptance criteria; exemplar editor.md (E3 on Linux VM).
Enforcement: agent.

## rule/long-content-survives
Scope: rows, chips, tabs, breadcrumbs, headers.
Rule: test with long session titles, long branch names
("lucas/eng-169-research-herdr-dagrs-dag-model"), many Workspaces (11+),
long commands in approval wells, and 5-digit line numbers. Truncate with
an ellipsis and a tooltip, or wrap deliberately; never wrap a label inside
a fixed-height control.
Why: agents generate titles and branch names; they are long and unpredictable.
Exceptions: none.
Source: Machine bar artboard (11+ workspaces); mockup fix rounds where tab
labels and footer buttons wrapped (exemplars constellation.md, editor.md).
Enforcement: agent.

## Notes

- Interrupted Turns: after a Daemon restart the Turn is marked Interrupted
  and the session moves to Needs You with Continue (ENG-176). Design it.
- Claude Code's Stop hook does not fire on interrupt (docs/research/
  herdr-dagr.md); never show "done" from absence of activity. Use
  evidence tiers (done · verified / reported / heuristic / asserted).
- Empty and first-run states use the pixel scene with a clearing
  (DESIGN.md, Pixel scenes; rule/scene-text-contrast).
