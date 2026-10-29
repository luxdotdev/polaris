import { describe, expect, test } from "bun:test";
import {
  DomainEvent,
  Sequence,
  SessionStreamItem,
  Subagent,
  SubagentDetail,
  SubagentId,
  TurnDetail,
} from "@polaris/protocol";
import { at, event, session, sessionId, snapshot, turn } from "./daemon.testing.ts";
import { applySessionItem, type SessionFold } from "./fold.ts";

const helper = (id: string, status: Subagent["status"] = "working") =>
  new Subagent({
    id: SubagentId.make(id),
    sessionId,
    turnId: turn(0).id,
    parentItemId: null,
    title: `Helper ${id}`,
    agent: "Explore",
    model: null,
    status,
    startedAt: at,
    endedAt: status === "working" ? null : at,
  });

const fold = (...items: ReadonlyArray<SessionStreamItem>): SessionFold | null =>
  items.reduce<SessionFold | null>(applySessionItem, null);

describe("subagents", () => {
  test("a snapshot keeps every Turn's Subagents, in order", () => {
    const opened = SessionStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(1),
      session: session({ turnCount: 2 }),
      turns: [0, 1].map(
        (index) =>
          new TurnDetail({
            turn: turn(index),
            items: [],
            subagents: [new SubagentDetail({ subagent: helper(`a${index}`), items: [] })],
          })
      ),
      pendingApprovals: [],
    });

    expect(fold(opened)?.subagents.map((s) => String(s.id))).toEqual(["a0", "a1"]);
  });

  test("a Subagent ending is updated in its place, not added again", () => {
    const state = fold(
      snapshot([{ turn: turn(0, { status: "working" }) }]),
      event(2, DomainEvent.cases.SubagentStarted.make({ subagent: helper("a") })),
      event(3, DomainEvent.cases.SubagentStarted.make({ subagent: helper("b") })),
      event(4, DomainEvent.cases.SubagentEnded.make({ subagent: helper("a", "completed") }))
    );

    expect(state?.subagents.map((s) => `${s.id} ${s.status}`)).toEqual([
      "a completed",
      "b working",
    ]);
  });
});
