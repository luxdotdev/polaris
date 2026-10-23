import { expect, test } from "bun:test";
import {
  AgentSession,
  DomainEvent,
  EventEnvelope,
  Sequence,
  SessionId,
  SessionStreamItem,
  SubagentId,
  Turn,
  TurnDetail,
  TurnId,
  TurnItem,
  WorkspaceId,
} from "@polaris/protocol";
import { applySessionItem, type SessionState } from "./sessionView.ts";

const at = "2026-10-23T12:00:00.000Z";

const turnId = TurnId.make("t1");

const session = new AgentSession({
  id: SessionId.make("s1"),
  workspaceId: WorkspaceId.make("w1"),
  harness: "claude",
  title: "Session",
  cwd: "/repo",
  worktreeId: null,
  state: "working",
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
});

const turn = new Turn({
  id: turnId,
  sessionId: session.id,
  index: 0,
  prompt: "hi",
  attachments: [],
  model: null,
  effort: null,
  status: "working",
  checkpointBefore: null,
  checkpointAfter: null,
  startedAt: at,
  endedAt: null,
});

const completed = (sequence: number, id: string, subagent: string | null = null) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: at,
      commandId: null,
      event: DomainEvent.cases.TurnItemCompleted.make({
        sessionId: session.id,
        turnId,
        item: TurnItem.cases.AssistantMessage.make({ id, text: id }),
        subagentId: subagent === null ? null : SubagentId.make(subagent),
      }),
    }),
  });

const delta = (itemId: string, text: string, subagent: string | null = null) =>
  SessionStreamItem.cases.Delta.make({
    turnId,
    itemId,
    field: "text",
    text,
    subagentId: subagent === null ? null : SubagentId.make(subagent),
  });

const fold = (items: ReadonlyArray<SessionStreamItem>) =>
  items.reduce<SessionState | null>(applySessionItem, null);

const start = [
  SessionStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(10),
    session,
    turns: [new TurnDetail({ turn, items: [], subagents: [] })],
    pendingApprovals: [],
  }),
  SessionStreamItem.cases.Synchronized.make({ sequence: Sequence.make(10) }),
];

test("streaming text accumulates per item and gives way to the completed item", () => {
  const live = fold([...start, delta("m1", "Hel"), delta("m1", "lo"), delta("m2", "x")]);

  expect(live?.streaming.map((s) => [s.itemId, s.text])).toEqual([
    ["m1", "Hello"],
    ["m2", "x"],
  ]);

  const done = fold([...start, delta("m1", "Hel"), delta("m2", "x"), completed(11, "m1")]);

  expect(done?.streaming.map((s) => s.itemId)).toEqual(["m2"]);
  expect(done?.turns[0]?.items.map((item) => item.id)).toEqual(["m1"]);
});

test("a Subagent's items and deltas stay out of the Turn", () => {
  const state = fold([...start, delta("a1", "sub", "sa1"), completed(11, "a1", "sa1")]);

  expect(state?.streaming).toEqual([]);
  expect(state?.turns[0]?.items).toEqual([]);
});

test("an event at or before the applied sequence (a resumed feed) is not applied twice", () => {
  const state = fold([...start, completed(11, "m1"), completed(11, "m2")]);

  expect(state?.turns[0]?.items.map((item) => item.id)).toEqual(["m1"]);
  expect(state?.sequence).toBe(Sequence.make(11));
});
