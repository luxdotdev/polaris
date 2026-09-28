# Exemplar: Needs You inbox

Status: accepted (commit 2f25851)
Surface: Paper, Orchestrator page, artboard 6 "Needs You inbox · Light".
Why exemplary: the one place that ranks everything waiting on the user
across all Hosts, and the light-mode reference for the Orchestrator.

## Decisions worth repeating

### Cards for things you act on, lists for the rest
- What: each waiting session is a card (Harness tile, title, "Host ·
  Workspace · age"); approvals show the command in a sunken code well with
  Approve / Always here / Deny; Failed and In Terminal follow under "Also
  waiting on you" as compact one-line cards with one action.
- Rules exercised: rule/no-dashboard-clutter, rule/needs-you-is-loudest.
- Evidence: artboard 6; DESIGN.md, Needs You inbox.
- Repeat when: presenting actionable items across Hosts.

### Questions are answered in the conversation
- What: a question renders in the conversation as a card with a needs-you
  watercolour header strip and numbered answer rows, the recommended one
  filled.
- Rules exercised: rule/point-at-risk.
- Evidence: DESIGN.md, Needs You inbox.
- Repeat when: an agent asks the user to choose.

## Known flaws

- No dark counterpart; no empty inbox state.
