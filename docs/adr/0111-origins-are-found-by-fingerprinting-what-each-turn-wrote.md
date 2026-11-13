---
status: proposed (ENG-932)
---

# Origins are found by fingerprinting what each Turn wrote

## Context

A line of code should trace back to its Origin: the Agent Session and the Turns that wrote it,
for the editor's blame hover and for agents through the MCP `origins` tool. Nothing records
which session produced a commit. Accept returns commit SHAs but no event keeps them, commits made
outside Accept are never observed, and the per-Turn checkpoint refs that hold the evidence are
pruned.

Alternatives considered:

- **Watch for commits** and match each new commit's diff against recent Turns. Watching HEAD
  wakes an idle Daemon, and rebases, squashes and cherry-picks change SHAs, so links need
  re-matching.
- **Record it in the commit** (a trailer or git notes). Portable, but this repo strips session
  trailers, notes are rarely pushed, and sharing Origins with others belongs to multiplayer.

## Decision

When a Turn's checkpoint is recorded, the Daemon hashes each line the Turn added
(whitespace-normalised) and stores `(Workspace, line hash) → (Agent Session, Turn, time)`. To
find a line's Origins, the Client blames the line, hashes its content and looks it up, keeping
Turns from before the commit's time; a commit's Origins are the union over its added lines.
Lines too short or common to identify are skipped and resolved by the hunk around them.

The index is keyed by what was written, not by SHA, so it needs no watcher, survives checkpoint
pruning, rebase, squash, cherry-pick and commits made by hand, and resolves uncommitted lines the
same way. Each Daemon indexes its own sessions; the Desktop App asks every connected Host and
merges the answers. On upgrade, surviving checkpoints are fingerprinted once in the background.

## Consequences

- A line a human later edits gets the human's commit and no Origin, which is correct; a pure
  reformat loses its Origin too.
- Identical lines written by different Turns match all of them; the hunk and the commit time
  narrow it.
- Turns whose checkpoints were pruned before this shipped have no Origin.
- Origins are private to each Host until multiplayer decides what to publish.
- Deleting an Agent Session or Workspace deletes its fingerprints; archiving keeps them.
