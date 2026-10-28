/** Protocol values for Home's tests: sessions, approvals, Workspaces and host feed items. */
import {
  AgentSession,
  ApprovalQuestion,
  ApprovalRequest,
  ConstellationId,
  ConstellationSummary,
  DomainEvent,
  EventEnvelope,
  HostId,
  HostStreamItem,
  QuestionOption,
  RequestId,
  Sequence,
  SessionId,
  SessionSummary,
  TurnId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";

export const AT = "2026-10-27T12:00:00.000Z";

export const NOW = Date.parse(AT);

export const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

export const workspace = (id: string, name = id) =>
  new Workspace({
    id: WorkspaceId.make(id),
    path: `/code/${name}`,
    name,
    isGitRepo: true,
    worktreeRoot: `/code/${name}.worktrees`,
    hidden: false,
    registeredAt: AT,
  });

export interface SessionInput {
  readonly id: string;
  readonly state?: AgentSession["state"];
  readonly workspaceId?: string;
  readonly harness?: string;
  readonly title?: string;
  readonly updatedAt?: string;
  readonly turnCount?: number;
  readonly lastError?: string | null;
  readonly acceptedThroughIndex?: number | null;
}

export const session = (input: SessionInput) =>
  new AgentSession({
    id: SessionId.make(input.id),
    workspaceId: WorkspaceId.make(input.workspaceId ?? "w1"),
    harness: input.harness ?? "claude",
    title: input.title ?? input.id,
    cwd: "/code/polaris",
    worktreeId: null,
    state: input.state ?? "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: input.turnCount ?? 1,
    contextUsage: null,
    lastError: input.lastError ?? null,
    acceptedThroughIndex: input.acceptedThroughIndex ?? null,
    createdAt: AT,
    updatedAt: input.updatedAt ?? AT,
  });

export const commandApproval = (sessionId: string, id: string, command: string, openedAt = AT) =>
  new ApprovalRequest({
    id: RequestId.make(id),
    sessionId: SessionId.make(sessionId),
    turnId: TurnId.make(`${sessionId}-t1`),
    kind: "command",
    title: command,
    detail: command,
    options: [],
    openedAt,
  });

export const question = (sessionId: string, id: string, text: string, choices: string[]) =>
  new ApprovalRequest({
    id: RequestId.make(id),
    sessionId: SessionId.make(sessionId),
    turnId: TurnId.make(`${sessionId}-t1`),
    kind: "question",
    title: text,
    detail: null,
    options: choices,
    questions: [
      new ApprovalQuestion({
        header: "",
        question: text,
        options: choices.map((label) => new QuestionOption({ label, description: null })),
        multiSelect: false,
      }),
    ],
    openedAt: AT,
  });

export const summary = (s: AgentSession, pending: ReadonlyArray<ApprovalRequest> = []) =>
  new SessionSummary({
    session: s,
    pendingApprovals: pending,
    lastTurnPreview: null,
    subagents: [],
  });

export const constellation = (id: string, leadSessionId: string, workspaceId = "w1") =>
  new ConstellationSummary({
    id: ConstellationId.make(id),
    workspaceId: WorkspaceId.make(workspaceId),
    hostId: HostId.make("h1"),
    leadSessionId: SessionId.make(leadSessionId),
    name: id,
    state: "running",
    createdAt: AT,
  });

export interface SnapshotInput {
  readonly sequence?: number;
  readonly workspaces?: ReadonlyArray<Workspace>;
  readonly sessions?: ReadonlyArray<SessionSummary>;
  readonly constellations?: ReadonlyArray<ConstellationSummary>;
}

export const snapshot = (input: SnapshotInput = {}) =>
  HostStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(input.sequence ?? 1),
    workspaces: input.workspaces ?? [],
    worktrees: [],
    sessions: input.sessions ?? [],
    constellations: input.constellations ?? [],
  });

export const synchronized = (sequence = 1) =>
  HostStreamItem.cases.Synchronized.make({ sequence: Sequence.make(sequence) });

export const event = (sequence: number, domainEvent: DomainEvent, occurredAt = AT) =>
  HostStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt,
      commandId: null,
      event: domainEvent,
    }),
  });

export { DomainEvent };
