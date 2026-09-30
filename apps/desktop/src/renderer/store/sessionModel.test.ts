import { describe, expect, test } from "bun:test";
import {
  ApprovalDecision,
  type DomainEvent,
  DomainEvent as Events,
  SessionStreamItem,
  TurnDetail,
  TurnItem,
} from "@polaris/protocol";
import { applySessionItems, emptySessionModel } from "./sessionModel.ts";
import {
  approval,
  envelope,
  seq,
  session,
  sessionId,
  turn,
  turnId,
  turnWith,
} from "./fixtures.testing.ts";

const S = SessionStreamItem.cases;

const E = Events.cases;

const event = (sequence: number, e: DomainEvent) =>
  S.Event.make({ envelope: envelope(sequence, e) });

const message = TurnItem.cases.AssistantMessage.make({ id: "m1", text: "one two three" });

const started = applySessionItems(
  emptySessionModel,
  structuredClone([
    S.Snapshot.make({ sequence: seq(2), session, turns: [], pendingApprovals: [] }),
    S.Synchronized.make({ sequence: seq(2) }),
    event(3, E.TurnStarted.make({ turn })),
  ])
);

describe("session model", () => {
  test("a Snapshot carries the session and its Turns", () => {
    const model = applySessionItems(emptySessionModel, [
      S.Snapshot.make({
        sequence: seq(9),
        session,
        turns: [new TurnDetail({ turn, items: [message], subagents: [] })],
        pendingApprovals: [approval],
      }),
    ]);

    expect(model.session?.title).toBe("Proof session");
    expect(model.turns[0]?.items).toEqual([message]);
    expect(model.pendingApprovals).toEqual([approval]);
  });

  test("deltas stream into the live item until it completes", () => {
    const streaming = applySessionItems(started, [
      S.Delta.make({ turnId, itemId: "m1", field: "text", text: "one ", subagentId: null }),
      S.Delta.make({ turnId, itemId: "m1", field: "text", text: "two", subagentId: null }),
    ]);

    expect(streaming.turns[0]?.live.get("m1")?.text).toBe("one two");

    const done = applySessionItems(streaming, [
      event(4, E.TurnItemCompleted.make({ sessionId, turnId, item: message, subagentId: null })),
      S.Delta.make({ turnId, itemId: "m1", field: "text", text: " late", subagentId: null }),
    ]);

    expect(done.turns[0]?.items).toEqual([message]);
    expect(done.turns[0]?.live.size).toBe(0);
  });

  test("ItemProgress replaces an item's progress; TurnEnded clears what is left", () => {
    const running = TurnItem.cases.CommandExecution.make({
      id: "c1",
      command: "bun test",
      cwd: "/tmp",
      output: "",
      exitCode: null,
      status: "running",
    });

    const progressed = applySessionItems(started, [
      S.ItemProgress.make({ turnId, item: running, subagentId: null }),
      S.Delta.make({ turnId, itemId: "c1", field: "output", text: "ok\n", subagentId: null }),
    ]);

    const live = progressed.turns[0]?.live.get("c1");

    expect(live?.item).toEqual(running);
    expect(live?.output).toBe("ok\n");

    const ended = turnWith({ status: "completed", endedAt: turn.startedAt });
    const finished = applySessionItems(progressed, [event(4, E.TurnEnded.make({ turn: ended }))]);

    expect(finished.turns[0]?.turn.status).toBe("completed");
    expect(finished.turns[0]?.live.size).toBe(0);
  });

  test("state changes and approvals patch the session", () => {
    const model = applySessionItems(started, [
      event(4, E.SessionStateChanged.make({ sessionId, state: "needs-you", reason: null })),
      event(5, E.ApprovalRequested.make({ request: approval })),
    ]);

    expect(model.session?.state).toBe("needs-you");
    expect(model.session?.turnCount).toBe(1);
    expect(model.pendingApprovals).toHaveLength(1);

    const answered = applySessionItems(model, [
      event(
        6,
        E.ApprovalResolved.make({
          sessionId,
          requestId: approval.id,
          decision: ApprovalDecision.cases.Allow.make({ remember: false }),
          resolvedBy: "MacBook Pro",
        })
      ),
    ]);

    expect(answered.pendingApprovals).toEqual([]);
  });
});
