---
status: accepted
implements: ENG-513 (Celestials)
---

# A session's Celestial is assigned at creation

## Context

DESIGN.md's Chrome redesign marks each Agent Session with a Celestial (CONTEXT.md): fixed for
the session's life, no two active sessions in a Workspace sharing one, a Fork with its own, a
star for a Constellation's Lead, a moon of its parent's for a Subagent. Every Client must show
the same body for the same session, across restarts and devices, so a Client-side choice
(hashing the id, say) can't keep bodies unique within a Workspace.

## Decision

The smallest durable fact: `AgentSession.celestial`, a planet name, set by the Daemon on the
`SessionCreated` it logs and folded like the session's other facts.

- The decider picks it (`apps/daemon/src/store/celestial.ts`) for `StartSession`, `ForkSession`
  and a Constellation's worker sessions: the first planet that no active (non-archived)
  session in the Workspace shows, searched from a place set by the session id; when all twelve
  are shown, the least shared. A Fork is picked against its live parent, so it gets its own.
- Sessions logged before this have no field. The fold gives them the planet the same picker
  would have, against the sessions folded before them, so every replay agrees.
- The catalogue (`CELESTIAL_PLANETS`, `CELESTIAL_STARS`, `CELESTIAL_MOONS`) lives in
  `@polaris/protocol`; the drawings live in `@polaris/ui`. `CelestialBody` is an open string,
  so a body only a newer Daemon draws still decodes; Clients draw an unknown one as a planet.
- A Lead's star and a Subagent's moon are not stored. Leadership starts after creation and can
  be handed over, and Subagents are not Agent Sessions, so Clients derive them: a Lead shows the
  star its planet maps to (`leadStar`), a Subagent the moon at its place under its parent
  (`subagentMoon`), in the parent's Harness hue.

No Command changes and nothing is acknowledged, streamed or recovered differently, so the Quint
spec is unchanged.

## Consequences

- Planets are reused once a session is archived; an archived session keeps its own.
- Changing the picker or the planet order would move only sessions logged before this ADR,
  whose planet is derived on every fold; logged planets never move.
- Unarchiving can leave two active sessions with one planet; we accept that rather than
  reassign a body the user has learnt.
