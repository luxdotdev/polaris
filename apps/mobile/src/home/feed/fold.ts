/**
 * One Host's feed as Home reads it: Workspaces, agent sessions with their pending approvals,
 * and Constellations, folded from `subscribeHost` the way the Daemon folds its log.
 */
import {
  type AgentSession,
  type ApprovalRequest,
  type ConstellationSummary,
  constellationSummaryOf,
  type DomainEvent,
  type HostStreamItem,
  type Turn,
  type Workspace,
} from "@polaris/protocol";
import { Match } from "effect";

/** An agent session as plain data: the fold copies and patches it. */
export type Session = { readonly [K in keyof AgentSession]: AgentSession[K] };

/** A Constellation's listing as plain data. */
export type ConstellationListing = {
  readonly [K in keyof ConstellationSummary]: ConstellationSummary[K];
};

export interface SessionEntry {
  readonly session: Session;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  /** The latest Turn's reply as plain text, cut short; null before it says anything. */
  readonly replyPreview: string | null;
}

export interface HostFeedState {
  readonly sequence: number;
  /** True once the Daemon said everything up to now was sent. */
  readonly synchronized: boolean;
  readonly workspaces: ReadonlyMap<string, Workspace>;
  readonly sessions: ReadonlyMap<string, SessionEntry>;
  readonly constellations: ReadonlyMap<string, ConstellationListing>;
}

export const emptyHostFeed: HostFeedState = {
  sequence: 0,
  synchronized: false,
  workspaces: new Map(),
  sessions: new Map(),
  constellations: new Map(),
};

const withEntry = <V>(map: ReadonlyMap<string, V>, key: string, value: V | undefined) => {
  const next = new Map(map);

  if (value === undefined) next.delete(key);
  else next.set(key, value);

  return next;
};

type Fold = (state: HostFeedState, at: string) => HostFeedState;

type Change = (entry: SessionEntry) => SessionEntry;

const unchanged: Fold = (state) => state;

const onSession =
  (sessionId: string, change: Change): Fold =>
  (state, at) => {
    const entry = state.sessions.get(sessionId);

    if (entry === undefined) return state;
    const next = change(entry);
    const session = { ...next.session, updatedAt: at };

    return { ...state, sessions: withEntry(state.sessions, sessionId, { ...next, session }) };
  };

const patch =
  (fields: Partial<Session>): Change =>
  (entry) => ({ ...entry, session: { ...entry.session, ...fields } });

const withoutRequest =
  (requestId: string): Change =>
  (entry) => ({
    ...entry,
    pendingApprovals: entry.pendingApprovals.filter((request) => request.id !== requestId),
  });

const onTurn = (turn: Turn): Fold =>
  onSession(turn.sessionId, (entry) => ({
    ...patch({ turnCount: Math.max(entry.session.turnCount, turn.index + 1) })(entry),
    replyPreview: turn.replyPreview ?? entry.replyPreview,
  }));

const withWorkspace =
  (workspace: Workspace): Fold =>
  (state) => ({ ...state, workspaces: withEntry(state.workspaces, workspace.id, workspace) });

const onConstellation =
  (id: string, change: (summary: ConstellationListing) => ConstellationListing): Fold =>
  (state) => {
    const summary = state.constellations.get(id);

    return summary === undefined
      ? state
      : { ...state, constellations: withEntry(state.constellations, id, change(summary)) };
  };

const sessionFolds = {
  SessionCreated:
    ({ session }: { readonly session: AgentSession }): Fold =>
    (state) => ({
      ...state,
      sessions: withEntry(state.sessions, session.id, {
        session,
        pendingApprovals: [],
        replyPreview: null,
      }),
    }),
  SessionStateChanged: (event: Extract<DomainEvent, { _tag: "SessionStateChanged" }>) =>
    onSession(
      event.sessionId,
      patch({
        state: event.state,
        lastError: event.state === "failed" ? event.reason : null,
        limitResetsAt: event.state === "limited" ? (event.resetsAt ?? null) : null,
      })
    ),
  SessionRenamed: (event: Extract<DomainEvent, { _tag: "SessionRenamed" }>) =>
    onSession(event.sessionId, patch({ title: event.title })),
  SessionPinned: (event: Extract<DomainEvent, { _tag: "SessionPinned" }>) =>
    onSession(event.sessionId, patch({ pinnedAt: event.pinnedAt })),
  SessionBackgroundTasksChanged: (
    event: Extract<DomainEvent, { _tag: "SessionBackgroundTasksChanged" }>
  ) => onSession(event.sessionId, patch({ backgroundTasks: event.tasks })),
  TurnStarted: ({ turn }: { readonly turn: Turn }) => onTurn(turn),
  TurnEnded: ({ turn }: { readonly turn: Turn }) => onTurn(turn),
  ApprovalRequested: ({ request }: { readonly request: ApprovalRequest }) =>
    onSession(request.sessionId, (entry) => ({
      ...entry,
      pendingApprovals: [...withoutRequest(request.id)(entry).pendingApprovals, request],
    })),
  ApprovalResolved: (event: Extract<DomainEvent, { _tag: "ApprovalResolved" }>) =>
    onSession(event.sessionId, withoutRequest(event.requestId)),
  ApprovalWithdrawn: (event: Extract<DomainEvent, { _tag: "ApprovalWithdrawn" }>) =>
    onSession(event.sessionId, withoutRequest(event.requestId)),
};

const fold = (event: DomainEvent): Fold =>
  Match.value(event).pipe(
    Match.tags({
      ...sessionFolds,
      WorkspaceRegistered: ({ workspace }) => withWorkspace(workspace),
      WorkspaceUpdated: ({ workspace }) => withWorkspace(workspace),
      WorkspaceRemoved:
        ({ workspaceId }): Fold =>
        (state) => ({ ...state, workspaces: withEntry(state.workspaces, workspaceId, undefined) }),
      ConstellationStarted:
        ({ constellation }): Fold =>
        (state) => ({
          ...state,
          constellations: withEntry(
            state.constellations,
            constellation.id,
            constellationSummaryOf(constellation)
          ),
        }),
      ConstellationStateChanged: ({ constellationId, state }) =>
        onConstellation(constellationId, (summary) => ({ ...summary, state })),
      LeadChanged: ({ constellationId, to }) =>
        onConstellation(constellationId, (summary) => ({ ...summary, leadSessionId: to })),
    }),
    Match.orElse(() => unchanged)
  );

const fromSnapshot = (snapshot: Extract<HostStreamItem, { _tag: "Snapshot" }>): HostFeedState => ({
  sequence: snapshot.sequence,
  synchronized: false,
  workspaces: new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace])),
  sessions: new Map(
    snapshot.sessions.map((summary) => [
      summary.session.id,
      {
        session: summary.session,
        pendingApprovals: summary.pendingApprovals,
        replyPreview: summary.session.lastReplyPreview ?? null,
      },
    ])
  ),
  constellations: new Map(
    (snapshot.constellations ?? []).map((constellation) => [constellation.id, constellation])
  ),
});

/** Applies one item of the Host's feed. Replayed events (an old sequence) are ignored. */
export const applyHostItem = (state: HostFeedState, item: HostStreamItem): HostFeedState =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: fromSnapshot,
      Event: ({ envelope }) =>
        envelope.sequence <= state.sequence
          ? state
          : { ...fold(envelope.event)(state, envelope.occurredAt), sequence: envelope.sequence },
      Synchronized: ({ sequence }): HostFeedState => ({ ...state, sequence, synchronized: true }),
    })
  );
