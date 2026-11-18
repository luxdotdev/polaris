import { describe, expect, test } from "bun:test";
import { Actor, DomainEvent, PersonId, QueuedTurn, ShareId, TurnId } from "@polaris/protocol";
import { at, event, sessionId, snapshot, turn } from "../thread/daemon.testing.ts";
import { applySessionItem, type SessionFold } from "../thread/fold.ts";
import type { Viewer } from "./model.ts";
import { mayChangeQueued, pausedLine, queueView } from "./queue.ts";

const teammate = (id: string, name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${id}`),
    personId: PersonId.make(id),
    name,
  });

const maya = teammate("maya", "Maya Chen");

const alex = teammate("alex", "Alex Rivera");

const queued = (id: string, actor: Actor) =>
  new QueuedTurn({
    id: TurnId.make(id),
    sessionId,
    prompt: `prompt ${id}`,
    attachments: [],
    actor,
    queuedAt: at,
    editedAt: null,
    approves: true,
  });

const fold = (...items: ReadonlyArray<Parameters<typeof applySessionItem>[1]>) =>
  items.reduce<SessionFold | null>(applySessionItem, null);

describe("a shared session's queue in the thread", () => {
  test("queued Turns keep their order and authors; an edit stays in place, a start and a cancel leave", () => {
    const state = fold(
      snapshot([{ turn: turn(0, { status: "working" }) }]),
      event(2, DomainEvent.cases.TurnQueued.make({ turn: queued("q1", maya) })),
      event(3, DomainEvent.cases.TurnQueued.make({ turn: queued("q2", alex) })),
      event(4, DomainEvent.cases.TurnQueued.make({ turn: queued("q3", maya) })),
      event(
        5,
        DomainEvent.cases.QueuedTurnEdited.make({
          sessionId,
          turnId: TurnId.make("q2"),
          prompt: "run the slow tier too",
          actor: alex,
        })
      ),
      event(
        6,
        DomainEvent.cases.QueuedTurnCancelled.make({
          sessionId,
          turnId: TurnId.make("q3"),
          actor: maya,
          reason: null,
        })
      ),
      event(
        7,
        DomainEvent.cases.TurnStarted.make({
          turn: turn(1, { id: TurnId.make("q1"), status: "working", actor: maya }),
          actor: maya,
        })
      )
    );

    const view = queueView(state);

    expect(view.turns.map((q) => [String(q.id), q.prompt])).toEqual([
      ["q2", "run the slow tier too"],
    ]);
    expect(view.paused).toBe(false);
  });

  test("Turns waiting behind a stopped Turn read as paused", () => {
    const state = fold(
      snapshot([{ turn: turn(0, { status: "interrupted" }) }]),
      event(2, DomainEvent.cases.TurnQueued.make({ turn: queued("q1", maya) })),
      event(3, DomainEvent.cases.TurnQueued.make({ turn: queued("q2", alex) }))
    );

    expect(queueView(state).paused).toBe(true);
    expect(pausedLine(queueView(state).turns.length)).toBe("Queue paused · 2 turns");
  });

  test("its author or the owner may change a queued Turn; another Teammate may not", () => {
    const asMaya: Viewer = {
      kind: "teammate",
      personId: "maya",
      role: "contributor",
      ownerName: "Lucas Doell",
    };

    expect([queued("q1", maya), queued("q2", alex)].map((q) => mayChangeQueued(q, asMaya))).toEqual(
      [true, false]
    );
    expect(mayChangeQueued(queued("q2", alex), { kind: "owner" })).toBe(true);
  });
});
