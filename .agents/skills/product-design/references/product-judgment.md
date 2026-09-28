# Product judgment

Load for Shape, Mock, Implement, Harden, full Review, or any material change.

## Decision brief

Before proposing UI, write one compact brief (internally, or to the user in
Shape mode):

- **User and moment**: the developer supervising agents (PRODUCT.md, Users).
  Are they scanning many sessions, answering one that Needs You, reviewing a
  Turn, or reading and editing code themselves?
- **Job**: what judgment or action does this surface serve, and what happens
  next (approve, steer, accept, open in Review, take over in terminal)?
- **Domain objects**: which CONTEXT.md terms are in play (Host, Workspace,
  Agent Session, Turn, Risk Finding, Constellation, Task, Attempt...), and
  where each one is identified on screen.
- **Who is authoritative**: the Harness, the Daemon, the orchestrating
  session, or the user? Mechanical state (Session State, Connection State)
  is never authored by an agent; intent (Tasks, Gates) is.
- **Consequence and reversibility**: what the action changes, on which Host,
  and whether it can be undone.
- **Non-goals** and **open decisions**, stated, never buried in a mockup.

## Choosing the intervention

- Smallest coherent change: better defaults, reuse of an existing
  component or artboard pattern, before new UI.
- Decide structure before decoration: which zone owns it (Input, Intent,
  Output in the Orchestrator; queue, risk column, diff in Review; explorer
  and editor pane in the Editor).
- Lists before cards; cards only for objects the user acts on
  (DESIGN.md, rule/no-dashboard-clutter).
- One primary button per view. Name what it does ("Accept and open PR").
- Point attention at risk: Needs You and Critical/High findings rank above
  everything; nothing hides a Critical (PRODUCT.md, Principle 3).
- The code is the content: chrome recedes wherever code or diffs are read
  (PRODUCT.md, Principle 5).

## Offering choices

When a decision is genuinely the user's (a new surface's structure, a name,
a direction), offer two or three options with ASCII previews and a
recommendation, then build the chosen one. Evidence: the Constellation
agent-view decision (exemplar constellation.md) and the star shape A/B/C
choice (exemplar brand.md).

## Material vs mechanical

Material (needs the brief): task, default, scope, consequence, navigation,
interaction surface, domain vocabulary, or reachable states. Mechanical:
token replacement, copy mechanics, established component reuse, spacing.
