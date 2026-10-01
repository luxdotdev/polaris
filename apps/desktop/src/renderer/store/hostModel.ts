/**
 * One Host's read model in the renderer: its Workspaces, Worktrees and Agent
 * Sessions (with pending approvals), folded from the host feed exactly as the
 * Daemon folds its log (`apps/daemon/src/store/model.ts`). A Snapshot resets it.
 */
import type {
  Sequence,
  ApprovalRequest,
  Subagent,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  ReviewCheckout,
  Workspace,
  Worktree,
} from "@polaris/protocol";
import { Match } from "effect";
import type { SessionData } from "./plain.ts";

/** An approval a Client answered: who, when, and what it was (for "Answered on <device>"). */
export interface ResolvedApproval {
  readonly request: ApprovalRequest;
  /** The device label of the Client that answered first (`ApprovalResolved.resolvedBy`). */
  readonly resolvedBy: string;
  readonly decision: "Allow" | "Deny" | "Answer";
  readonly at: string;
}

/** How many resolutions a session keeps. */
const RESOLVED_KEPT = 3;

export interface SessionEntry {
  readonly session: SessionData;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  /** The latest resolutions this Client saw live, newest last; not in snapshots. */
  readonly resolved?: ReadonlyArray<ResolvedApproval>;
  readonly lastTurnPreview: string | null;
  /** Subagents still working in this session. */
  readonly subagents: ReadonlyArray<Subagent>;
}

export interface HostModel {
  readonly sequence: Sequence;
  /** False until the feed says everything up to now has arrived (or while painted from cache). */
  readonly synchronized: boolean;
  /** Painted from the last cached snapshot; replaced by the first live Snapshot. */
  readonly fromCache: boolean;
  readonly workspaces: ReadonlyMap<string, Workspace>;
  readonly worktrees: ReadonlyMap<string, Worktree>;
  readonly sessions: ReadonlyMap<string, SessionEntry>;
  /** Review Checkouts on this Host, by id. */
  readonly reviewCheckouts: ReadonlyMap<string, ReviewCheckout>;
}

export const emptyHostModel: HostModel = {
  // SAFETY: sequences start at 1, so 0 precedes every real one.
  sequence: 0 as Sequence,
  synchronized: false,
  fromCache: false,
  workspaces: new Map(),
  worktrees: new Map(),
  sessions: new Map(),
  reviewCheckouts: new Map(),
};

const withEntry = <V>(map: ReadonlyMap<string, V>, key: string, value: V | undefined) => {
  const next = new Map(map);

  if (value === undefined) next.delete(key);
  else next.set(key, value);

  return next;
};

const entryOf = (summary: SessionEntry): SessionEntry => ({
  session: summary.session,
  pendingApprovals: summary.pendingApprovals,
  lastTurnPreview: summary.lastTurnPreview,
  subagents: summary.subagents,
});

type SessionChange = (entry: SessionEntry) => SessionEntry;

interface SessionUpdate {
  readonly model: HostModel;
  readonly sessionId: string;
  readonly at: string;
  readonly change: SessionChange;
}

/** Applies `change` to a session's entry and stamps `updatedAt`; unknown sessions are ignored. */
const updateSession = ({ model, sessionId, at, change }: SessionUpdate): HostModel => {
  const entry = model.sessions.get(sessionId);

  if (entry === undefined) return model;
  const next = change(entry);

  return {
    ...model,
    sessions: withEntry(model.sessions, sessionId, {
      ...next,
      session: { ...next.session, updatedAt: at },
    }),
  };
};

const patch =
  (fields: Partial<SessionData>): SessionChange =>
  (entry) => ({ ...entry, session: { ...entry.session, ...fields } });

const withoutRequest =
  (requestId: string): SessionChange =>
  (entry) => ({
    ...entry,
    pendingApprovals: entry.pendingApprovals.filter((r) => r.id !== requestId),
  });

type Fold = (model: HostModel, at: string) => HostModel;

const onSession =
  (sessionId: string, change: SessionChange): Fold =>
  (model, at) =>
    updateSession({ model, sessionId, at, change });

const onTurn = (turn: {
  readonly sessionId: string;
  readonly index: number;
  readonly prompt: string;
}) =>
  onSession(turn.sessionId, (entry) => ({
    ...entry,
    lastTurnPreview: turn.prompt.slice(0, 140),
    session: { ...entry.session, turnCount: Math.max(entry.session.turnCount, turn.index + 1) },
  }));

const removeWorkspace =
  (workspaceId: string): Fold =>
  (model) => ({
    ...model,
    workspaces: withEntry(model.workspaces, workspaceId, undefined),
    worktrees: new Map([...model.worktrees].filter(([, wt]) => wt.workspaceId !== workspaceId)),
  });

const unchanged: Fold = (model) => model;

const withCheckout =
  (checkoutId: string, checkout: ReviewCheckout | undefined): Fold =>
  (model) => ({
    ...model,
    reviewCheckouts: withEntry(model.reviewCheckouts, checkoutId, checkout),
  });

const fold = (event: DomainEvent): Fold =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      // Constellation events are projected in their own view.
      ConstellationStarted: () => unchanged,
      ConstellationStateChanged: () => unchanged,
      LeadChanged: () => unchanged,
      TaskDeclared: () => unchanged,
      TaskEdited: () => unchanged,
      TaskCanceled: () => unchanged,
      TaskProposed: () => unchanged,
      ProposalAccepted: () => unchanged,
      ProposalDeclined: () => unchanged,
      AttemptStarted: () => unchanged,
      AttemptProgressed: () => unchanged,
      AttemptClaimed: () => unchanged,
      AttemptAccepted: () => unchanged,
      AttemptRejected: () => unchanged,
      AttemptSettled: () => unchanged,
      GatePromoted: () => unchanged,
      NotificationQueued: () => unchanged,
      LeadNotified: () => unchanged,
      OperatorMessageSent: () => unchanged,
      OperatorMessageResolved: () => unchanged,
      PeerMessage: () => unchanged,
      AttemptRecoveryContinued: () => unchanged,
      ResourceDeclared: () => unchanged,
      ResourceRemoved: () => unchanged,
      ResourceLeaseCanceled: () => unchanged,
      ResourceLeaseQueued: () => unchanged,
      ResourceLeased: () => unchanged,
      ResourceReleased: () => unchanged,

      WorkspaceRegistered:
        ({ workspace }): Fold =>
        (m) => ({
          ...m,
          workspaces: withEntry(m.workspaces, workspace.id, workspace),
        }),
      WorkspaceUpdated:
        ({ workspace }): Fold =>
        (m) => ({
          ...m,
          workspaces: withEntry(m.workspaces, workspace.id, workspace),
        }),
      WorkspaceRemoved: ({ workspaceId }) => removeWorkspace(workspaceId),
      WorktreeDetected:
        ({ worktree }): Fold =>
        (m) => ({
          ...m,
          worktrees: withEntry(m.worktrees, worktree.id, worktree),
        }),
      WorktreeRemoved:
        ({ worktreeId }): Fold =>
        (m) => ({
          ...m,
          worktrees: withEntry(m.worktrees, worktreeId, undefined),
        }),
      SessionCreated:
        ({ session }): Fold =>
        (m) => ({
          ...m,
          sessions: withEntry(m.sessions, session.id, {
            session,
            pendingApprovals: [],
            lastTurnPreview: null,
            subagents: [],
          }),
        }),
      SessionStateChanged: ({ sessionId, state, reason }) =>
        onSession(sessionId, (entry) =>
          patch({ state, lastError: state === "failed" ? reason : entry.session.lastError })(entry)
        ),
      SessionRenamed: ({ sessionId, title }) => onSession(sessionId, patch({ title })),
      SessionCursorUpdated: ({ sessionId, harnessCursor }) =>
        onSession(sessionId, patch({ harnessCursor })),
      SessionModelChanged: ({ sessionId, model, effort }) =>
        onSession(sessionId, patch({ model, effort })),
      SessionPermissionModeChanged: ({ sessionId, permissionMode }) =>
        onSession(sessionId, patch({ permissionMode })),
      SessionContextUsed: ({ sessionId, usage }) =>
        onSession(sessionId, patch({ contextUsage: usage })),
      TurnStarted: ({ turn }) => onTurn(turn),
      TurnEnded: ({ turn }) => onTurn(turn),
      TurnItemCompleted: () => unchanged,
      SubagentStarted: () => unchanged,
      SubagentEnded: () => unchanged,
      CheckpointRecorded: () => unchanged,
      TurnsAccepted: ({ sessionId, throughIndex }) =>
        onSession(sessionId, patch({ acceptedThroughIndex: throughIndex })),
      TurnsReverted: () => unchanged,
      SessionPullRequestLinked: ({ sessionId, pullRequest }) =>
        onSession(sessionId, patch({ pullRequest })),
      ReviewCheckoutOpened: ({ checkout }) => withCheckout(checkout.id, checkout),
      ReviewCheckoutChanged: ({ checkout }) => withCheckout(checkout.id, checkout),
      ReviewCheckoutRemoved: ({ checkoutId }) => withCheckout(checkoutId, undefined),
      // Risk Summaries and Verdicts are review-only: the Review UI keeps its own (M2-F).
      RiskSummaryStarted: () => unchanged,
      RiskSummaryLayerChanged: () => unchanged,
      RiskFindingsRecorded: () => unchanged,
      RiskFindingResolved: () => unchanged,
      RiskSummaryEnded: () => unchanged,
      VerdictRecorded: () => unchanged,
      ApprovalRequested: ({ request }) =>
        onSession(request.sessionId, (entry) => ({
          ...entry,
          pendingApprovals: [...withoutRequest(request.id)(entry).pendingApprovals, request],
        })),
      ApprovalResolved:
        ({ sessionId, requestId, resolvedBy, decision }): Fold =>
        (m, at) =>
          updateSession({
            model: m,
            sessionId,
            at,
            change: (entry) => {
              const request = entry.pendingApprovals.find((r) => r.id === requestId);
              const next = withoutRequest(requestId)(entry);

              if (request === undefined) return next;
              const resolution = { request, resolvedBy, decision: decision._tag, at };

              return {
                ...next,
                resolved: [...(entry.resolved ?? []), resolution].slice(-RESOLVED_KEPT),
              };
            },
          }),
      ApprovalWithdrawn: ({ sessionId, requestId }) =>
        onSession(sessionId, withoutRequest(requestId)),
    })
  );

export const applyEnvelope = (model: HostModel, envelope: EventEnvelope): HostModel => {
  // Resumed feeds never repeat a sequence; this guards a replayed cache.
  if (envelope.sequence <= model.sequence) return model;

  return { ...fold(envelope.event)(model, envelope.occurredAt), sequence: envelope.sequence };
};

export interface HostSnapshot {
  readonly sequence: Sequence;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly worktrees: ReadonlyArray<Worktree>;
  readonly sessions: ReadonlyArray<SessionEntry>;
  readonly reviewCheckouts?: ReadonlyArray<ReviewCheckout>;
}

/** A Snapshot resets the model; so does a cached one, marked `fromCache` by its caller. */
export const modelFromSnapshot = (snapshot: HostSnapshot): HostModel => ({
  sequence: snapshot.sequence,
  synchronized: false,
  fromCache: false,
  workspaces: new Map(snapshot.workspaces.map((w) => [w.id, w])),
  worktrees: new Map(snapshot.worktrees.map((w) => [w.id, w])),
  sessions: new Map(snapshot.sessions.map((s) => [s.session.id, entryOf(s)])),
  reviewCheckouts: new Map((snapshot.reviewCheckouts ?? []).map((c) => [c.id, c])),
});

export const applyHostItem = (model: HostModel, item: HostStreamItem): HostModel =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: (snapshot) => modelFromSnapshot(snapshot),
      Event: ({ envelope }) => applyEnvelope(model, envelope),
      Synchronized: (): HostModel => ({ ...model, synchronized: true }),
    })
  );

export const applyHostItems = (model: HostModel, items: ReadonlyArray<HostStreamItem>) =>
  items.reduce(applyHostItem, model);

/** Sessions of a Workspace, most recently updated first; archived ones left out. */
export const sessionsOf = (model: HostModel, workspaceId: string): ReadonlyArray<SessionEntry> =>
  [...model.sessions.values()]
    .filter((e) => e.session.workspaceId === workspaceId && e.session.state !== "archived")
    .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt));

/** Visible Workspaces in registration order. */
export const visibleWorkspaces = (model: HostModel): ReadonlyArray<Workspace> =>
  [...model.workspaces.values()]
    .filter((w) => !w.hidden)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
