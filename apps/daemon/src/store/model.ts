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
  DomainEvent,
  type EventEnvelope,
  type RequestId,
  type SessionId,
  Turn,
  type TurnId,
  type Workspace,
  type WorkspaceId,
  type Worktree,
  type WorktreeId,
} from "@polaris/protocol";

export interface SessionRecord {
  readonly session: AgentSession;
  /** Set once the user renames the session; Harness title suggestions are then ignored. */
  readonly titleLocked: boolean;
  /**
   * The most recent Turns (at most `RECENT_TURNS`), ordered by `index`. The
   * session's `turnCount` counts all of them; older ones are in SQL.
   */
  readonly turns: ReadonlyArray<Turn>;
  readonly pending: ReadonlyMap<RequestId, ApprovalRequest>;
}

export interface ReadModel {
  /** Sequence of the last event folded in; 0 for an empty store. */
  readonly sequence: number;
  readonly workspaces: ReadonlyMap<WorkspaceId, Workspace>;
  readonly worktrees: ReadonlyMap<WorktreeId, Worktree>;
  readonly sessions: ReadonlyMap<SessionId, SessionRecord>;
}

export const emptyModel: ReadModel = {
  sequence: 0,
  workspaces: new Map(),
  worktrees: new Map(),
  sessions: new Map(),
};

/**
 * How many Turns per session the read model keeps in memory. The Turn in flight
 * is always the latest, so it is always among them.
 */
export const RECENT_TURNS = 32;

// ── Stream classification ───────────────────────────────────────────────────

const hostEvent = () => null;

const bySessionId = (event: { readonly sessionId: SessionId }) => event.sessionId;

const byTurn = (event: { readonly turn: Turn }) => event.turn.sessionId;

/** The Agent Session an event belongs to, or null for Host-level events. */
export const sessionOf: (event: DomainEvent) => SessionId | null =
  DomainEvent.match<SessionId | null>({
    WorkspaceRegistered: hostEvent,
    WorkspaceUpdated: hostEvent,
    WorkspaceRemoved: hostEvent,
    WorktreeDetected: hostEvent,
    WorktreeRemoved: hostEvent,
    SessionCreated: (event) => event.session.id,
    SessionStateChanged: bySessionId,
    SessionRenamed: bySessionId,
    SessionCursorUpdated: bySessionId,
    SessionPermissionModeChanged: bySessionId,
    SessionModelChanged: bySessionId,
    TurnStarted: byTurn,
    TurnItemCompleted: bySessionId,
    TurnEnded: byTurn,
    ApprovalRequested: (event) => event.request.sessionId,
    ApprovalResolved: bySessionId,
    ApprovalWithdrawn: bySessionId,
    CheckpointRecorded: bySessionId,
  });

/**
 * Event types the Host stream leaves out: per-item output and checkpoints only
 * matter to a Client that has the session open.
 */
export const sessionOnlyEventTypes: ReadonlyArray<DomainEvent["_tag"]> = [
  "TurnItemCompleted",
  "CheckpointRecorded",
];

export const isHostStreamEvent = (event: DomainEvent): boolean =>
  !sessionOnlyEventTypes.includes(event._tag);

// ── Helpers ─────────────────────────────────────────────────────────────────

export const lastTurn = (record: SessionRecord): Turn | undefined =>
  record.turns[record.turns.length - 1];

export const workingTurn = (record: SessionRecord): Turn | undefined =>
  record.turns.find((turn) => turn.status === "working");

export const checkpointLabel = (ref: string): "before" | "after" | null => {
  if (ref.endsWith("/before")) return "before";

  return ref.endsWith("/after") ? "after" : null;
};

export type SessionPatch = Partial<typeof AgentSession.Type>;

/** A copy of `session` with `patch` applied. */
export const patchSession = (session: AgentSession, patch: SessionPatch): AgentSession =>
  new AgentSession({
    id: session.id,
    workspaceId: session.workspaceId,
    harness: session.harness,
    title: session.title,
    cwd: session.cwd,
    worktreeId: session.worktreeId,
    state: session.state,
    permissionMode: session.permissionMode,
    model: session.model,
    effort: session.effort,
    parentSessionId: session.parentSessionId,
    forkedFromTurnId: session.forkedFromTurnId,
    harnessCursor: session.harnessCursor,
    turnCount: session.turnCount,
    lastError: session.lastError,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...patch,
  });

export type TurnPatch = Partial<typeof Turn.Type>;

/** A copy of `turn` with `patch` applied. */
export const patchTurn = (turn: Turn, patch: TurnPatch): Turn =>
  new Turn({
    id: turn.id,
    sessionId: turn.sessionId,
    index: turn.index,
    prompt: turn.prompt,
    attachments: turn.attachments,
    model: turn.model,
    effort: turn.effort,
    status: turn.status,
    checkpointBefore: turn.checkpointBefore,
    checkpointAfter: turn.checkpointAfter,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    ...patch,
  });

const withMap = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): Map<K, V> => {
  const next = new Map(map);

  if (value === undefined) next.delete(key);
  else next.set(key, value);

  return next;
};

const upsertTurn = (turns: ReadonlyArray<Turn>, turn: Turn): ReadonlyArray<Turn> => {
  const at = turns.findIndex((t) => t.id === turn.id);

  if (at === -1) {
    // A Turn older than every one in memory was evicted already and is final.
    if (turns.length >= RECENT_TURNS && turn.index < turns[0]!.index) return turns;
    const next = [...turns, turn].sort((a, b) => a.index - b.index);

    return next.length > RECENT_TURNS ? next.slice(next.length - RECENT_TURNS) : next;
  }

  const next = [...turns];
  next[at] = turn;

  return next;
};

// ── Reducer ─────────────────────────────────────────────────────────────────

/** The model an event is folded into, and what its envelope says about it. */
interface Fold {
  readonly model: ReadModel;
  readonly at: string;
  /** The event records a Client's command (it carries a command id). */
  readonly byClient: boolean;
}

type Reducer = (fold: Fold) => ReadModel;

/** What one event changes in a session's record; `session` patches its fields. */
interface RecordChange {
  readonly session?: SessionPatch;
  readonly titleLocked?: boolean;
  readonly turns?: ReadonlyArray<Turn>;
  readonly pending?: ReadonlyMap<RequestId, ApprovalRequest>;
}

/** Apply `f`'s change to a session's record; every change also sets `updatedAt`. */
const updateSession = (
  fold: Fold,
  sessionId: SessionId,
  f: (record: SessionRecord) => RecordChange
): ReadModel => {
  const { model } = fold;
  const record = model.sessions.get(sessionId);

  if (record === undefined) return model;
  const change = f(record);

  const next: SessionRecord = {
    session: patchSession(record.session, { ...change.session, updatedAt: fold.at }),
    titleLocked: change.titleLocked ?? record.titleLocked,
    turns: change.turns ?? record.turns,
    pending: change.pending ?? record.pending,
  };

  return { ...model, sessions: withMap(model.sessions, sessionId, next) };
};

const setWorkspace =
  (event: { readonly workspace: Workspace }): Reducer =>
  ({ model }) => ({
    ...model,
    workspaces: withMap(model.workspaces, event.workspace.id, event.workspace),
  });

const removeWorkspace =
  (event: { readonly workspaceId: WorkspaceId }): Reducer =>
  ({ model }) => {
    const worktrees = new Map(model.worktrees);

    for (const [id, wt] of worktrees)
      if (wt.workspaceId === event.workspaceId) worktrees.delete(id);

    return {
      ...model,
      workspaces: withMap(model.workspaces, event.workspaceId, undefined),
      worktrees,
    };
  };

const createSession =
  (event: { readonly session: AgentSession }): Reducer =>
  ({ model }) => ({
    ...model,
    sessions: withMap(model.sessions, event.session.id, {
      session: event.session,
      titleLocked: false,
      turns: [],
      pending: new Map(),
    }),
  });

const recordTurn =
  ({ turn }: { readonly turn: Turn }): Reducer =>
  (fold) =>
    updateSession(fold, turn.sessionId, (r) => ({
      // Turn indexes are dense from 0, so the count is one past the highest seen.
      session: { turnCount: Math.max(r.session.turnCount, turn.index + 1) },
      turns: upsertTurn(r.turns, turn),
    }));

const recordCheckpoint =
  (event: {
    readonly sessionId: SessionId;
    readonly turnId: TurnId;
    readonly ref: string;
  }): Reducer =>
  (fold) => {
    const label = checkpointLabel(event.ref);

    if (label === null) return fold.model;

    return updateSession(fold, event.sessionId, (r) => {
      const turn = r.turns.find((t) => t.id === event.turnId);

      if (turn === undefined) return {};

      const updated = patchTurn(
        turn,
        label === "before" ? { checkpointBefore: event.ref } : { checkpointAfter: event.ref }
      );

      return { turns: upsertTurn(r.turns, updated) };
    });
  };

const resolveRequest =
  (event: { readonly sessionId: SessionId; readonly requestId: RequestId }): Reducer =>
  (fold) =>
    updateSession(fold, event.sessionId, (r) => ({
      pending: withMap(r.pending, event.requestId, undefined),
    }));

const apply: (event: DomainEvent) => Reducer = DomainEvent.match<Reducer>({
  WorkspaceRegistered: setWorkspace,
  WorkspaceUpdated: setWorkspace,
  WorkspaceRemoved: removeWorkspace,
  WorktreeDetected:
    ({ worktree }) =>
    ({ model }) => ({ ...model, worktrees: withMap(model.worktrees, worktree.id, worktree) }),
  WorktreeRemoved:
    ({ worktreeId }) =>
    ({ model }) => ({ ...model, worktrees: withMap(model.worktrees, worktreeId, undefined) }),
  SessionCreated: createSession,
  SessionStateChanged: (event) => (fold) =>
    updateSession(fold, event.sessionId, (r) => ({
      session: {
        state: event.state,
        lastError: event.state === "failed" ? event.reason : r.session.lastError,
      },
    })),
  SessionRenamed: (event) => (fold) =>
    updateSession(fold, event.sessionId, (r) => ({
      // A rename a Client asked for (it carries a command id) locks the title.
      titleLocked: r.titleLocked || fold.byClient,
      session: { title: event.title },
    })),
  SessionCursorUpdated: (event) => (fold) =>
    updateSession(fold, event.sessionId, () => ({
      session: { harnessCursor: event.harnessCursor },
    })),
  SessionPermissionModeChanged: (event) => (fold) =>
    updateSession(fold, event.sessionId, () => ({
      session: { permissionMode: event.permissionMode },
    })),
  SessionModelChanged: (event) => (fold) =>
    updateSession(fold, event.sessionId, () => ({
      session: { model: event.model, effort: event.effort },
    })),
  TurnStarted: recordTurn,
  TurnEnded: recordTurn,
  TurnItemCompleted:
    () =>
    ({ model }) =>
      model,
  CheckpointRecorded: recordCheckpoint,
  ApprovalRequested:
    ({ request }) =>
    (fold) =>
      updateSession(fold, request.sessionId, (r) => ({
        pending: withMap(r.pending, request.id, request),
      })),
  ApprovalResolved: resolveRequest,
  ApprovalWithdrawn: resolveRequest,
});

export const project = (model: ReadModel, envelope: EventEnvelope): ReadModel => {
  const next = apply(envelope.event)({
    model,
    at: envelope.occurredAt,
    byClient: envelope.commandId !== null,
  });

  return { ...next, sequence: envelope.sequence };
};

/**
 * Fold events into one session's record exactly as `project` would, without
 * the rest of the model. The session lifecycle machine (`engine/session.ts`)
 * updates its context with it, so its snapshot is always the one the log folds to.
 */
export const foldSession = (
  sessionId: SessionId,
  record: SessionRecord | undefined,
  events: ReadonlyArray<DomainEvent>,
  occurredAt: string
): SessionRecord | undefined => {
  let model: ReadModel = {
    ...emptyModel,
    sessions: record === undefined ? new Map() : new Map([[sessionId, record]]),
  };

  for (const event of events) model = apply(event)({ model, at: occurredAt, byClient: false });

  return model.sessions.get(sessionId);
};
