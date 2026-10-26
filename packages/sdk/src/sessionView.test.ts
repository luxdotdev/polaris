import { expect, test } from "bun:test";
import {
  AgentSession,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
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
import { applyHostItem, emptyHostState } from "./hostView.ts";

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

const makeTurn = (status: "working" | "interrupted" = "working") =>
  new Turn({
    id: turnId,
    sessionId: session.id,
    index: 0,
    prompt: "hi",
    attachments: [],
    model: null,
    effort: null,
    status,
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: at,
    endedAt: status === "working" ? null : at,
  });

const turn = makeTurn();

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

test.each(["limited", "failed"] as const)(
  "both feeds keep the %s reason, reset and timestamp current",
  (state) => {
    const changedAt = "2026-10-23T13:00:00.000Z";
    const resetsAt = "2026-10-23T14:00:00.000Z";

    const envelope = new EventEnvelope({
      sequence: Sequence.make(11),
      occurredAt: changedAt,
      commandId: null,
      event: DomainEvent.cases.SessionStateChanged.make({
        sessionId: session.id,
        state,
        reason: "Harness stopped",
        resetsAt,
      }),
    });

    const host = [
      HostStreamItem.cases.Event.make({
        envelope: new EventEnvelope({
          sequence: Sequence.make(10),
          occurredAt: at,
          commandId: null,
          event: DomainEvent.cases.SessionCreated.make({ session, actor: null }),
        }),
      }),
      HostStreamItem.cases.Event.make({ envelope }),
    ].reduce(applyHostItem, emptyHostState);

    const detail = fold([...start, SessionStreamItem.cases.Event.make({ envelope })]);

    for (const actual of [host.sessions.get(session.id)?.session, detail?.session]) {
      expect(actual).toMatchObject({
        state,
        lastError: state === "failed" ? "Harness stopped" : null,
        limitResetsAt: state === "limited" ? resetsAt : null,
        updatedAt: changedAt,
      });
    }
  }
);

test("ending an interrupted Turn removes its unfinished streaming text", () => {
  const state = fold([
    ...start,
    delta("unfinished", "Partial reply"),
    SessionStreamItem.cases.Event.make({
      envelope: new EventEnvelope({
        sequence: Sequence.make(11),
        occurredAt: at,
        commandId: null,
        event: DomainEvent.cases.TurnEnded.make({
          turn: makeTurn("interrupted"),
        }),
      }),
    }),
  ]);

  expect(state?.streaming).toEqual([]);
  expect(state?.turns[0]?.turn.status).toBe("interrupted");
});

test("Synchronized records the replay cut even when a session had no events", () => {
  const cut = Sequence.make(50);
  const detail = fold([...start, SessionStreamItem.cases.Synchronized.make({ sequence: cut })]);

  const host = applyHostItem(
    emptyHostState,
    HostStreamItem.cases.Synchronized.make({ sequence: cut })
  );

  expect(detail?.sequence).toBe(cut);
  expect(host.sequence).toBe(cut);
});
