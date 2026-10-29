import { expect, test } from "bun:test";
import {
  AgentSession,
  ConstellationId,
  ConstellationSummary,
  DomainEvent,
  EventEnvelope,
  HostId,
  HostStreamItem,
  Sequence,
  SessionId,
  SessionSummary,
  Turn,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "./fold.ts";

const at = "2026-10-29T00:00:00.000Z";

const session = (id: string, workspaceId: string) =>
  new SessionSummary({
    session: new AgentSession({
      id: SessionId.make(id),
      workspaceId: WorkspaceId.make(workspaceId),
      harness: "claude",
      title: id,
      cwd: "/repo",
      worktreeId: null,
      state: "archived",
      permissionMode: "supervised",
      model: null,
      effort: null,
      parentSessionId: null,
      forkedFromTurnId: null,
      harnessCursor: null,
      turnCount: 1,
      contextUsage: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    }),
    pendingApprovals: [],
    lastTurnPreview: null,
    subagents: [],
  });

const constellation = (id: string, workspaceId: string) =>
  new ConstellationSummary({
    id: ConstellationId.make(id),
    workspaceId: WorkspaceId.make(workspaceId),
    hostId: HostId.make("h1"),
    leadSessionId: SessionId.make(`${id}-lead`),
    name: id,
    state: "completed",
    createdAt: at,
  });

test("a removed Workspace takes its sessions and constellations off Home", () => {
  const items = [
    HostStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(5),
      workspaces: [],
      worktrees: [],
      sessions: [session("gone", "w-gone"), session("kept", "w-kept")],
      constellations: [constellation("c-gone", "w-gone"), constellation("c-kept", "w-kept")],
    }),
    HostStreamItem.cases.Event.make({
      envelope: new EventEnvelope({
        sequence: Sequence.make(6),
        occurredAt: at,
        commandId: null,
        event: DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: WorkspaceId.make("w-gone") }),
      }),
    }),
  ];

  const state = items.reduce(applyHostItem, emptyHostFeed);

  expect([...state.sessions.keys()]).toEqual(["kept"]);
  expect([...state.constellations.keys()]).toEqual(["c-kept"]);
});

const turn = (index: number, fields: Partial<Turn>) =>
  new Turn({
    id: TurnId.make(`t-${index}`),
    sessionId: SessionId.make("s"),
    index,
    prompt: `prompt ${index}`,
    attachments: [],
    model: null,
    effort: null,
    status: "completed",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: at,
    endedAt: at,
    ...fields,
  });

const ended = (sequence: number, ending: Turn) =>
  HostStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: at,
      commandId: null,
      event: DomainEvent.cases.TurnEnded.make({ turn: ending }),
    }),
  });

test("idle compaction's Turn leaves the last reply on Home", () => {
  const items = [
    HostStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(1),
      workspaces: [],
      worktrees: [],
      sessions: [session("s", "w")],
      constellations: [],
    }),
    ended(2, turn(0, { replyPreview: "The parser is split" })),
    ended(3, turn(1, { prompt: "/compact", idleCompaction: true, replyPreview: "Compacted" })),
  ];

  const entry = items.reduce(applyHostItem, emptyHostFeed).sessions.get("s");

  expect(entry?.replyPreview).toBe("The parser is split");
  expect(entry?.session.turnCount).toBe(2);
});
