---
status: accepted
implements: ENG-458 (Mobile App continuity)
---

# Read position and drafts live beside the event log

## Context

DESIGN.md's Mobile App asks that an Agent Session's read position (the last Turn the user has
seen) and its composer draft follow the session between Clients ("Draft saved"). Both change
often (a draft on every pause in typing), neither changes what the session is or what its
Harness does, and neither needs replaying, acknowledging or recovering like a Command.

## Decision

The Daemon keeps them in two SQL tables next to the projections, `session_reads` and
`session_drafts` (`apps/daemon/src/store/continuity.ts`), written outside group commit and never
in `events` or the read model. Clients use their own RPCs, not `dispatch` (capability
`session.continuity`, Client-only):

- `continuity.watch`: a Snapshot of every read position and every draft, emptied ones with
  their revisions (so a Client that missed a clear applies it), then each change.
  Only real changes are sent: a save of the same text or an earlier Turn sends nothing.
- `continuity.markRead`: the position only moves forward, by Turn index; Clients report the
  newest ended Turn on screen. Unread is `unreadTurns` in the protocol, counted by the latest
  Turn's status rather than the Session State, so every Client counts the same way. Migration 6 reads existing sessions through their last ended Turn.
- `continuity.saveDraft`: last writer wins, numbered by a per-session revision.
  `@polaris/client/continuity` debounces writes (500 ms) and holds back another Client's draft
  while this one has unwritten typing or a write in flight.

## Consequences

- The event log, the spec (`packages/spec`) and recovery are unchanged: nothing here is decided,
  committed, acknowledged, streamed or resumed through the command path.
- Writes from one Client go one at a time per session, so an older write can't land or fail
  after a newer one. A draft whose write failed is kept, past closing the session, and written
  again when the Host's feed next opens, before any older Host draft is adopted; a refused read
  report is reported again then too. Text only, staged attachments are not synced.
- A Client reconnecting gets a fresh Snapshot rather than resuming from a sequence.
