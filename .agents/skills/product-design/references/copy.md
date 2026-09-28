# Copy

Voice source: PRODUCT.md, Brand Commitments (terse, peer to peer). Vocabulary
source: CONTEXT.md.

## rule/glossary-exact
Scope: all UI copy, mockup text, notifications, and component names.
Rule: use CONTEXT.md terms exactly and never their _Avoid_ words: "agent
session" not "thread" or "chat"; "needs you" not "waiting" or "blocked";
"turn" not "step"; "constellation" not "plan" or "run"; "working" not
"running" or "thinking". Capitalization follows rule/glossary-not-proper-nouns.
Why: the glossary is shared by code, docs, and UI; drift in any one breaks
the others, and the user learns one word per concept.
Exceptions: proper nouns keep capitals (Polaris, Claude Code, Codex, Mac
Studio, PR and repo titles as authored).
Source: owner directive 2026-09-28 (lowercase rule); CONTEXT.md.
Enforcement: agent.
Bad: "Waiting for Approval", "Thread 23", "Plan · Session rows v2".
Good: "Needs you · wants to run cargo build", "turn 23", "Session rows v2"
under a Constellation tab.

## rule/glossary-not-proper-nouns
Scope: all UI copy, mockup text, notifications, component specs.
Rule: glossary terms are common nouns in the UI. Write them lowercase
unless they start a sentence or label: "verdict", "risk summary", "turn",
"worktree", "workspace", "host", "agent session", "needs you", "risk
finding", "constellation", "task". Only true proper nouns keep capitals:
Polaris, Harness products (Claude Code, Codex), machine names (Mac
Studio, Linux VM), and PR or repo titles as their authors wrote them.
CONTEXT.md capitalises its headwords as a document convention; that never
carries into the UI.
Why: capitalised common nouns read as jargon and branding, and they drift
("Agent Session" in one place, "session" in another); lowercase keeps the
glossary exact without shouting it.
Exceptions: the start of a sentence or label ("Needs you · turn 9", "Save
verdict", "Risk summary").
Source: owner directive 2026-09-28 (Review mockups); memory
glossary-terms-lowercase-in-copy; DESIGN.md, rule/glossary-lowercase.
Enforcement: agent.
Bad: "Save Verdict", "Open the Risk Summary", "on a new Worktree",
"4 Hosts · 11 Workspaces", "Constellation · 12 Tasks".
Good: "Save verdict", "Open the risk summary", "on a new worktree",
"4 hosts · 11 workspaces", "12 tasks"; "Claude Code needs you" (the
Harness is a proper noun, the state is not).

## rule/say-what-happened
Scope: status lines, second lines of session rows, toasts, errors.
Rule: say what the agent is doing or wants, concretely, with the object:
"Wants to run cargo build", "Writing layout variants...", "Ready to review
· 3 files", "Codex exited on Pi 4 · Retry". Never generic progress words.
Why: the user supervises by scanning; a concrete line saves opening the
session.
Exceptions: none.
Source: brand deck slide 04 (Voice) instead-of/write table; exemplar
orchestrator-elevated.md.
Enforcement: agent.
Bad: "Your AI is thinking...", "Oops! Something went wrong".
Good: "Claude Code is working · 1m 12s", "Accept paused · 1 critical".

## rule/copy-no-rationale
Scope: all UI copy.
Rule: copy says what the user sees and can do, never why the interface was
built that way. Rationale lives in DESIGN.md and exemplars.
Why: rationale in the UI reads as the product thinking out loud; agents are
prone to it.
Exceptions: none; state facts ("Rule changes wait for you"), not reasons.
Source: carried from sightline (2026-07-10); applies unchanged.
Enforcement: agent.

## rule/destructive-names-object
Scope: destructive or consequential actions (archive, delete branch, deny,
stop, take over).
Rule: the button names verb and object ("Archive session", "Delete
branch"), the surface states scope and whether it can be undone, and an
unmerged branch is never deleted without asking (ENG-176).
Why: agents act on real repositories on remote Hosts.
Exceptions: none.
Source: ENG-176 resolution (archiving keeps the branch); sightline pattern.
Enforcement: agent.

## Mechanics

- Sentence case everywhere (DESIGN.md, rule/sentence-case). No all caps,
  no emoji, no exclamation marks, no hype words (PRODUCT.md, Voice).
- Separators: " · " between facts on one line ("Host · Workspace · age").
- Keyboard hints as small keycaps after the label ("Accept ⌘↵", "Reject
  esc"), in `text-faint`.
- Counts and durations use tabular figures (DESIGN.md,
  rule/tabular-numbers).
- The wordmark "Polaris" appears only where Polaris names itself
  (DESIGN.md, Brand); Polaris's own actor in lists is "polaris reviewer".
