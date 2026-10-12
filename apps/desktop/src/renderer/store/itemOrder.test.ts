import { describe, expect, test } from "bun:test";
import {
  type DomainEvent,
  DomainEvent as Events,
  SessionStreamItem,
  TurnDetail,
  TurnId,
  TurnItem,
  TurnPage,
} from "@polaris/protocol";
import {
  applySessionItems,
  emptySessionModel,
  entriesInStartOrder,
  withOlderTurns,
} from "./sessionModel.ts";
import { envelope, seq, session, sessionId, turn, turnId, turnWith } from "./fixtures.testing.ts";

const S = SessionStreamItem.cases;

const E = Events.cases;

const event = (sequence: number, e: DomainEvent) =>
  S.Event.make({ envelope: envelope(sequence, e) });

const at = (second: number) => `2026-10-11T10:00:${String(second).padStart(2, "0")}.000Z`;

const command = (id: string, second: number, status: "running" | "completed") =>
  TurnItem.cases.CommandExecution.make({
    id,
    command: id,
    cwd: "/repo",
    output: "",
    exitCode: status === "completed" ? 0 : null,
    status,
    startedAt: at(second),
  });

const done = (sequence: number, item: TurnItem) =>
  event(sequence, E.TurnItemCompleted.make({ sessionId, turnId, item, subagentId: null }));

const started = applySessionItems(emptySessionModel, [
  S.Snapshot.make({ sequence: seq(2), session, turns: [], pendingApprovals: [] }),
  S.Synchronized.make({ sequence: seq(2) }),
  event(3, E.TurnStarted.make({ turn })),
]);

const ids = (items: ReadonlyArray<{ readonly id: string }>) => items.map((i) => i.id);

describe("item order", () => {
  test("a long command that completes last sits where the model started it", () => {
    const model = applySessionItems(started, [
      S.ItemProgress.make({ turnId, item: command("sleep", 1, "running"), subagentId: null }),
      done(4, command("quick-1", 2, "completed")),
      done(5, command("quick-2", 3, "completed")),
      done(6, command("sleep", 1, "completed")),
    ]);

    expect(ids(model.turns[0]?.items ?? [])).toEqual(["sleep", "quick-1", "quick-2"]);
  });

  test("a Snapshot's items, listed as they completed, read as they started", () => {
    const model = applySessionItems(emptySessionModel, [
      S.Snapshot.make({
        sequence: seq(9),
        session,
        turns: [
          new TurnDetail({
            turn,
            items: [command("quick", 2, "completed"), command("sleep", 1, "completed")],
            subagents: [],
          }),
        ],
        pendingApprovals: [],
      }),
    ]);

    expect(ids(model.turns[0]?.items ?? [])).toEqual(["sleep", "quick"]);
  });

  test("a running command reads before what the model did after it; streaming text goes last", () => {
    const model = applySessionItems(started, [
      S.ItemProgress.make({ turnId, item: command("sleep", 1, "running"), subagentId: null }),
      done(4, command("quick", 2, "completed")),
      S.Delta.make({ turnId, itemId: "m1", field: "text", text: "Waiting", subagentId: null }),
    ]);

    const view = model.turns[0];

    expect(view === undefined ? [] : entriesInStartOrder(view)).toMatchObject([
      { kind: "live", id: "sleep" },
      { kind: "completed", id: "quick" },
      { kind: "live", id: "m1" },
    ]);
  });
});

describe("older Turns", () => {
  const older = (index: number) =>
    new TurnDetail({
      turn: turnWith({ id: TurnId.make(`older-${index}`), index, status: "completed" }),
      items: [command("quick", 2, "completed"), command("sleep", 1, "completed")],
      subagents: [],
    });

  test("a page goes before the Turns the feed opened on, items placed by start", () => {
    const model = withOlderTurns(
      started,
      new TurnPage({ turns: [older(-2), older(-1)], sequence: seq(3), hasMore: true })
    );

    expect(model.turns.map((t) => String(t.turn.id))).toEqual(["older--2", "older--1", turn.id]);
    expect(ids(model.turns[0]?.items ?? [])).toEqual(["sleep", "quick"]);
  });

  test("a Turn the model already has is left as the feed gave it", () => {
    const page = new TurnPage({
      turns: [new TurnDetail({ turn, items: [], subagents: [] })],
      sequence: seq(3),
      hasMore: false,
    });

    expect(withOlderTurns(started, page)).toBe(started);
  });
});
