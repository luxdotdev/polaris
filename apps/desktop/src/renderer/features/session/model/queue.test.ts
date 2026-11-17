import { describe, expect, test } from "bun:test";
import { Predicate } from "effect";
import {
  Actor,
  DomainEvent,
  PersonId,
  QueuedTurn,
  SessionStreamItem,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import {
  at,
  envelope,
  session,
  sessionId,
  seq,
  turn,
  turnWith,
} from "../../../store/fixtures.testing.ts";
import { applySessionItems, emptySessionModel } from "../../../store/sessionModel.ts";
import { mayChange, pausedLine, type QueueViewer, queueView } from "./queue.ts";

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const maya = teammate("Maya Chen");

const alex = teammate("Alex Rivera");

const owner = Actor.cases.Client.make({});

const queued = (id: string, actor: Actor, prompt = `prompt ${id}`) =>
  new QueuedTurn({
    id: TurnId.make(id),
    sessionId,
    prompt,
    attachments: [],
    actor,
    queuedAt: at,
    editedAt: null,
    approves: true,
  });

const snapshot = (queuedTurns: ReadonlyArray<QueuedTurn>, working = true) =>
  SessionStreamItem.cases.Snapshot.make({
    sequence: seq(1),
    session,
    turns: [
      { turn: working ? turn : turnWith({ status: "interrupted" }), items: [], subagents: [] },
    ],
    pendingApprovals: [],
    queuedTurns,
  });

const event = (n: number, e: DomainEvent) =>
  SessionStreamItem.cases.Event.make({ envelope: envelope(n, e) });

const queuedOf = (model: ReturnType<typeof applySessionItems>) =>
  queueView(model).turns.map((q): [string, string, string] => [
    q.id,
    Predicate.isTagged(q.actor, "Teammate") ? q.actor.name : "owner",
    q.prompt,
  ]);

describe("a shared session's queue in the renderer", () => {
  test("Turns queue in order with their authors; an edit keeps its place, a cancel and a start remove it", () => {
    const model = applySessionItems(emptySessionModel, [
      snapshot([]),
      event(2, DomainEvent.cases.TurnQueued.make({ turn: queued("q1", maya) })),
      event(3, DomainEvent.cases.TurnQueued.make({ turn: queued("q2", alex) })),
      event(4, DomainEvent.cases.TurnQueued.make({ turn: queued("q3", owner) })),
      event(
        5,
        DomainEvent.cases.QueuedTurnEdited.make({
          sessionId,
          turnId: TurnId.make("q1"),
          prompt: "Then publish all four as artifacts",
          actor: owner,
        })
      ),
      event(
        6,
        DomainEvent.cases.QueuedTurnCancelled.make({
          sessionId,
          turnId: TurnId.make("q2"),
          actor: alex,
          reason: null,
        })
      ),
    ]);

    expect(queuedOf(model)).toEqual([
      ["q1", "Maya Chen", "Then publish all four as artifacts"],
      ["q3", "owner", "prompt q3"],
    ]);

    const started = applySessionItems(model, [
      event(
        7,
        DomainEvent.cases.TurnStarted.make({
          turn: turnWith({ id: TurnId.make("q1"), index: 1, actor: maya }),
          actor: maya,
        })
      ),
    ]);

    expect(queuedOf(started)).toEqual([["q3", "owner", "prompt q3"]]);
    expect(queueView(started).paused).toBe(false);
  });

  test("a resync takes the snapshot's queue, and Turns waiting behind no Turn read as paused", () => {
    const live = applySessionItems(emptySessionModel, [
      snapshot([]),
      event(2, DomainEvent.cases.TurnQueued.make({ turn: queued("q1", maya) })),
    ]);

    const resynced = applySessionItems(live, [
      snapshot([queued("q1", maya), queued("q2", alex)], false),
    ]);

    const view = queueView(resynced);

    expect(view.turns.map((q) => String(q.id))).toEqual(["q1", "q2"]);
    expect(view.paused).toBe(true);
    expect(pausedLine(view.turns.length)).toBe("Queue paused · 2 Turns");
    expect(pausedLine(1)).toBe("Queue paused · 1 Turn");
  });

  test("its author or the owner may change a queued Turn; another Teammate may not", () => {
    const mine: QueueViewer = { kind: "teammate", names: ["maya chen", "mchen"] };
    const ownerViewer: QueueViewer = { kind: "owner" };
    const turns = [queued("q1", maya), queued("q2", alex), queued("q3", owner)];

    expect(turns.map((q) => mayChange(q, mine))).toEqual([true, false, false]);
    expect(turns.map((q) => mayChange(q, ownerViewer))).toEqual([true, true, true]);
  });
});
