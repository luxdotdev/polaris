import { expect, test } from "bun:test";
import {
  AgentSession,
  ApprovalRequest,
  ConstellationId,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  RequestId,
  Sequence,
  SessionId,
  SessionSummary,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { applyHostItem, emptyHostState, hostView } from "./hostView.ts";

const session = (
  id: string,
  state: AgentSession["state"],
  updatedAt: string,
  worker: AgentSession["worker"] = null
) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId: WorkspaceId.make("w1"),
    harness: "claude",
    title: id,
    cwd: "/repo",
    worktreeId: null,
    state,
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 1,
    contextUsage: null,
    lastError: null,
    worker,
    createdAt: updatedAt,
    updatedAt,
  });

const summary = (s: AgentSession) =>
  new SessionSummary({ session: s, pendingApprovals: [], lastTurnPreview: null, subagents: [] });

const host = { hostId: "h1", hostName: "Mac" };

const start = [
  HostStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(5),
    workspaces: [],
    worktrees: [],
    sessions: [
      summary(session("old", "archived", "2026-10-01T00:00:00.000Z")),
      summary(session("live", "idle", "2026-10-02T00:00:00.000Z")),
      summary(session("newer", "archived", "2026-10-03T00:00:00.000Z")),
    ],
  }),
  HostStreamItem.cases.Synchronized.make({ sequence: Sequence.make(5) }),
];

const archive = HostStreamItem.cases.Event.make({
  envelope: new EventEnvelope({
    sequence: Sequence.make(6),
    occurredAt: "2026-10-04T00:00:00.000Z",
    commandId: null,
    event: DomainEvent.cases.SessionStateChanged.make({
      sessionId: SessionId.make("live"),
      state: "archived",
      reason: null,
    }),
  }),
});

const viewOf = (items: ReadonlyArray<HostStreamItem>) =>
  hostView(items.reduce(applyHostItem, emptyHostState), host, true);

test("archived sessions are kept apart from the others, newest first", () => {
  const view = viewOf(start);

  expect(view.sessions.map((entry) => String(entry.session.id))).toEqual(["live"]);
  expect(view.archived.map((entry) => String(entry.session.id))).toEqual(["newer", "old"]);
});

test("a session archived live moves from sessions to archived", () => {
  const view = viewOf([...start, archive]);

  expect(view.sessions).toEqual([]);
  expect(view.archived.map((entry) => String(entry.session.id))).toEqual(["live", "newer", "old"]);
});

test("a removed Workspace takes its sessions, archived ones included", () => {
  const removed = HostStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(6),
      occurredAt: "2026-10-04T00:00:00.000Z",
      commandId: null,
      event: DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: WorkspaceId.make("w1") }),
    }),
  });

  const view = viewOf([...start, removed]);

  expect(view.sessions).toEqual([]);
  expect(view.archived).toEqual([]);
});

test("a Constellation worker is left out unless it needs you; its approvals stay", () => {
  const worker = (id: string, state: AgentSession["state"]) =>
    session(id, state, "2026-10-05T00:00:00.000Z", {
      constellationId: ConstellationId.make("c1"),
    });

  const request = new ApprovalRequest({
    id: RequestId.make("r1"),
    sessionId: SessionId.make("asking"),
    turnId: TurnId.make("t1"),
    kind: "command",
    title: "Run bun test",
    detail: null,
    options: [],
    openedAt: "2026-10-05T00:00:00.000Z",
  });

  const view = viewOf([
    HostStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(5),
      workspaces: [],
      worktrees: [],
      sessions: [
        summary(session("mine", "idle", "2026-10-02T00:00:00.000Z")),
        summary(worker("working", "working")),
        summary(worker("done", "archived")),
        new SessionSummary({
          session: worker("asking", "needs-you"),
          pendingApprovals: [request],
          lastTurnPreview: null,
          subagents: [],
        }),
      ],
    }),
  ]);

  expect([
    view.sessions.map((entry) => String(entry.session.id)),
    view.archived.map((entry) => String(entry.session.id)),
    view.approvals.map((approval) => String(approval.id)),
  ]).toEqual([["asking", "mine"], [], ["r1"]]);
});
