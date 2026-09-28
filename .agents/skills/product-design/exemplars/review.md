# Exemplar: Review

Status: accepted (commit 1a178f0)
Surface: Paper, Review page, R1 "Review · Pull request · Dark" and R2
"Review · Agent session turns · Light".
Why exemplary: the reference for Severity, the risk column, verdicts, and
diffs; one layout serves a PR and an agent session.

## Decisions worth repeating

### Queue, risk column, diff
- What: queue left, a 360px risk column, diff largest; the same layout for
  a PR (R1) and an agent session's turns (R2, grouped by turn).
- Rules exercised: rule/code-is-the-content; DESIGN.md, Review.
- Evidence: R1, R2.
- Repeat when: any change needs judging before it is accepted.

### Severity is a badge, twice on the flagged line
- What: ◆ Critical, ▲ High, ● Medium, ○ Low as filled badges with label;
  the flagged line gets the glyph in the gutter and a 2px rule in the
  severity colour.
- Rules exercised: rule/severity-is-a-badge, rule/severity-vs-state,
  rule/no-colour-alone.
- Evidence: R1 diff and risk column.
- Repeat when: showing any finding. Never use ◆ for anything else (the
  Constellation's gate is a square for this reason).

### Critical pauses acceptance, in words
- What: while a critical finding is open the accept button reads "Accept
  paused · 1 critical" and is disabled; the critical card says so.
- Rules exercised: rule/point-at-risk, rule/say-what-happened.
- Evidence: fix during the Review pass: the critical finding contradicted
  an enabled Accept button.
- Repeat when: any risk blocks a primary action. Say why on the button.

### The reviewer is Polaris, in Starlight
- What: the risk summary carries a Starlight-washed tile with the pixel
  north-star mark; "Ask the reviewer" and rule proposals carry the mark;
  rule changes wait for approval ("Rule changes wait for you").
- Rules exercised: rule/starlight-is-rare (Polaris's own work).
- Evidence: R1; DESIGN.md, Review. Carried into the Constellation as
  "polaris reviewer" with a Starlight dither.
- Repeat when: Polaris itself is the actor.

## Known flaws

- Verdict popover exists only in R1; no light variant of the risk memory
  proposal.
