/**
 * The in-memory read model: the current state of every Workspace, Worktree
 * and Agent Session on this Host, as a pure fold over `EventEnvelope`s.
 *
 * The decider validates commands against it, the stream snapshots are built
 * from it, and the SQL projection tables persist it (see `projection.ts`).
 * Turn items are the exception: they only live in SQL, and so do all but
 * the most recent `RECENT_TURNS` Turns of each session, so a long history
 * does not stay resident. Older Turns are finished and never change; read
 * them with `EventStore.readTurns`.
 */
import {
  AgentSession,
  type ApprovalRequest,
  type DomainEvent,
  type EventEnvelope,
  type RequestId,
  type SessionId,
  Turn,
  type Workspace,
  type WorkspaceId,
  type Worktree,
  type WorktreeId,
} from "@polaris/protocol"

export interface SessionRecord {
  readonly session: AgentSession
  /** Set once the user renames the session; Harness title suggestions are then ignored. */
  readonly titleLocked: boolean
  /**
   * The most recent Turns (at most `RECENT_TURNS`), ordered by `index`. The
   * session's `turnCount` counts all of them; older ones are in SQL.
   */
  readonly turns: ReadonlyArray<Turn>
  readonly pending: ReadonlyMap<RequestId, ApprovalRequest>
}

export interface ReadModel {
  /** Sequence of the last event folded in; 0 for an empty store. */
  readonly sequence: number
  readonly workspaces: ReadonlyMap<WorkspaceId, Workspace>
  readonly worktrees: ReadonlyMap<WorktreeId, Worktree>
  readonly sessions: ReadonlyMap<SessionId, SessionRecord>
}

export const emptyModel: ReadModel = {
  sequence: 0,
  workspaces: new Map(),
  worktrees: new Map(),
  sessions: new Map(),
}

/**
 * How many Turns per session the read model keeps in memory. The Turn in flight
 * is always the latest, so it is always among them.
 */
export const RECENT_TURNS = 32

// ── Stream classification ───────────────────────────────────────────────────

/** The Agent Session an event belongs to, or null for Host-level events. */
export const sessionOf = (event: DomainEvent): SessionId | null => {
  switch (event._tag) {
    case "WorkspaceRegistered":
    case "WorkspaceUpdated":
    case "WorkspaceRemoved":
    case "WorktreeDetected":
    case "WorktreeRemoved":
      return null
    case "SessionCreated":
      return event.session.id
    case "TurnStarted":
    case "TurnEnded":
      return event.turn.sessionId
    case "ApprovalRequested":
      return event.request.sessionId
    default:
      return event.sessionId
  }
}

/**
 * Event types the Host stream leaves out: per-item output and checkpoints only
 * matter to a Client that has the session open.
 */
export const sessionOnlyEventTypes: ReadonlyArray<DomainEvent["_tag"]> = [
  "TurnItemCompleted",
  "CheckpointRecorded",
]

export const isHostStreamEvent = (event: DomainEvent): boolean =>
  !sessionOnlyEventTypes.includes(event._tag)

// ── Helpers ─────────────────────────────────────────────────────────────────

export const lastTurn = (record: SessionRecord): Turn | undefined =>
  record.turns[record.turns.length - 1]

export const workingTurn = (record: SessionRecord): Turn | undefined =>
  record.turns.find((turn) => turn.status === "working")

export const checkpointLabel = (ref: string): "before" | "after" | null =>
  ref.endsWith("/before") ? "before" : ref.endsWith("/after") ? "after" : null

const withMap = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): Map<K, V> => {
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}

const upsertTurn = (turns: ReadonlyArray<Turn>, turn: Turn): ReadonlyArray<Turn> => {
  const at = turns.findIndex((t) => t.id === turn.id)
  if (at === -1) {
    // A Turn older than every one in memory was evicted already and is final.
    if (turns.length >= RECENT_TURNS && turn.index < turns[0]!.index) return turns
    const next = [...turns, turn].sort((a, b) => a.index - b.index)
    return next.length > RECENT_TURNS ? next.slice(next.length - RECENT_TURNS) : next
  }
  const next = [...turns]
  next[at] = turn
  return next
}

const updateSession = (
  model: ReadModel,
  sessionId: SessionId,
  occurredAt: string,
  f: (record: SessionRecord) => SessionRecord,
): ReadModel => {
  const record = model.sessions.get(sessionId)
  if (record === undefined) return model
  const next = f(record)
  const session = new AgentSession({ ...next.session, updatedAt: occurredAt })
  return { ...model, sessions: withMap(model.sessions, sessionId, { ...next, session }) }
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export const project = (model: ReadModel, envelope: EventEnvelope): ReadModel => {
  const next = apply(model, envelope)
  return { ...next, sequence: envelope.sequence }
}

const apply = (model: ReadModel, envelope: EventEnvelope): ReadModel => {
  const event = envelope.event
  const at = envelope.occurredAt
  switch (event._tag) {
    case "WorkspaceRegistered":
    case "WorkspaceUpdated":
      return {
        ...model,
        workspaces: withMap(model.workspaces, event.workspace.id, event.workspace),
      }
    case "WorkspaceRemoved": {
      const worktrees = new Map(model.worktrees)
      for (const [id, wt] of worktrees)
        if (wt.workspaceId === event.workspaceId) worktrees.delete(id)
      return {
        ...model,
        workspaces: withMap(model.workspaces, event.workspaceId, undefined),
        worktrees,
      }
    }
    case "WorktreeDetected":
      return { ...model, worktrees: withMap(model.worktrees, event.worktree.id, event.worktree) }
    case "WorktreeRemoved":
      return { ...model, worktrees: withMap(model.worktrees, event.worktreeId, undefined) }
    case "SessionCreated":
      return {
        ...model,
        sessions: withMap(model.sessions, event.session.id, {
          session: event.session,
          titleLocked: false,
          turns: [],
          pending: new Map(),
        }),
      }
    case "SessionStateChanged":
      return updateSession(model, event.sessionId, at, (r) => ({
        ...r,
        session: new AgentSession({
          ...r.session,
          state: event.state,
          lastError: event.state === "failed" ? event.reason : r.session.lastError,
        }),
      }))
    case "SessionRenamed":
      return updateSession(model, event.sessionId, at, (r) => ({
        ...r,
        // A rename a Client asked for (it carries a command id) locks the title.
        titleLocked: r.titleLocked || envelope.commandId !== null,
        session: new AgentSession({ ...r.session, title: event.title }),
      }))
    case "SessionCursorUpdated":
      return updateSession(model, event.sessionId, at, (r) => ({
        ...r,
        session: new AgentSession({ ...r.session, harnessCursor: event.harnessCursor }),
      }))
    case "SessionPermissionModeChanged":
      return updateSession(model, event.sessionId, at, (r) => ({
        ...r,
        session: new AgentSession({ ...r.session, permissionMode: event.permissionMode }),
      }))
    case "TurnStarted":
    case "TurnEnded":
      return updateSession(model, event.turn.sessionId, at, (r) => ({
        ...r,
        session: new AgentSession({
          ...r.session,
          // Turn indexes are dense from 0, so the count is one past the highest seen.
          turnCount: Math.max(r.session.turnCount, event.turn.index + 1),
        }),
        turns: upsertTurn(r.turns, event.turn),
      }))
    case "TurnItemCompleted":
      return model
    case "CheckpointRecorded": {
      const label = checkpointLabel(event.ref)
      if (label === null) return model
      return updateSession(model, event.sessionId, at, (r) => {
        const turn = r.turns.find((t) => t.id === event.turnId)
        if (turn === undefined) return r
        const updated = new Turn({
          ...turn,
          ...(label === "before"
            ? { checkpointBefore: event.ref }
            : { checkpointAfter: event.ref }),
        })
        return { ...r, turns: upsertTurn(r.turns, updated) }
      })
    }
    case "ApprovalRequested":
      return updateSession(model, event.request.sessionId, at, (r) => ({
        ...r,
        pending: withMap(r.pending, event.request.id, event.request),
      }))
    case "ApprovalResolved":
    case "ApprovalWithdrawn":
      return updateSession(model, event.sessionId, at, (r) => ({
        ...r,
        pending: withMap(r.pending, event.requestId, undefined),
      }))
  }
}
