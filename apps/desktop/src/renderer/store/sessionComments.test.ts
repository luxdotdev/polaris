import { describe, expect, test } from "bun:test";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  DomainEvent,
  PersonId,
  SessionStreamItem,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import { envelope, session, sessionId, seq, turn, turnId, turnWith } from "./fixtures.testing.ts";
import { applySessionItem, applySessionItems, emptySessionModel } from "./sessionModel.ts";

const ana = Actor.cases.Teammate.make({
  shareId: ShareId.make("share-ana"),
  personId: PersonId.make("person-ana"),
  name: "Ana",
});

const comment = (id: string, author: Actor = ana) =>
  new Comment({
    id: CommentId.make(id),
    sessionId,
    anchor: CommentAnchor.cases.MessageText.make({
      turnId,
      messageId: "m1",
      start: 0,
      end: 5,
      quote: "Hello",
    }),
    body: "Say it louder",
    author,
    createdAt: "2026-11-16T10:00:00.000Z",
  });

const snapshot = (comments: ReadonlyArray<Comment>) =>
  SessionStreamItem.cases.Snapshot.make({
    sequence: seq(1),
    session,
    turns: [{ turn, items: [], subagents: [] }],
    pendingApprovals: [],
    comments,
  });

const event = (n: number, e: DomainEvent) =>
  SessionStreamItem.cases.Event.make({ envelope: envelope(n, e) });

describe("a session's Comments in the renderer", () => {
  test("a Teammate's Comment arrives live, and a later snapshot (a restart) brings it back", () => {
    const live = applySessionItems(emptySessionModel, [
      snapshot([]),
      event(2, DomainEvent.cases.CommentAdded.make({ comment: comment("c1") })),
    ]);

    expect(live.comments?.map((c): [string, Actor] => [c.id, c.author])).toEqual([["c1", ana]]);

    const resynced = applySessionItem(live, snapshot([comment("c1")]));

    expect(resynced.comments?.map((c) => c.author)).toEqual([ana]);
  });

  test("edits, resolution, reopening and the outdated mark fold onto the Comment", () => {
    const by = (n: number, e: DomainEvent) => event(n, e);
    const id = CommentId.make("c1");
    const later = TurnId.make("t2");

    const model = applySessionItems(emptySessionModel, [
      snapshot([comment("c1")]),
      by(
        2,
        DomainEvent.cases.CommentEdited.make({
          sessionId,
          commentId: id,
          body: "Louder",
          actor: ana,
        })
      ),
      by(3, DomainEvent.cases.CommentResolved.make({ sessionId, commentId: id, actor: ana })),
      by(4, DomainEvent.cases.CommentOutdated.make({ sessionId, commentId: id, turnId: later })),
    ]);

    const folded = model.comments?.[0];

    expect(folded?.body).toBe("Louder");
    expect(folded?.editedAt).not.toBeNull();
    expect(folded?.resolvedBy).toEqual(ana);
    expect(folded?.outdatedInTurnId).toBe(later);

    const reopened = applySessionItem(
      model,
      by(5, DomainEvent.cases.CommentReopened.make({ sessionId, commentId: id, actor: ana }))
    );

    expect(reopened.comments?.[0]?.resolvedAt).toBeNull();
  });

  test("a Turn that carried Comments marks each sent with it, and keeps its sender", () => {
    const sent = turnWith({
      id: TurnId.make("t2"),
      index: 1,
      commentIds: [CommentId.make("c1")],
      actor: ana,
    });

    const model = applySessionItems(emptySessionModel, [
      snapshot([comment("c1"), comment("c2")]),
      event(2, DomainEvent.cases.TurnStarted.make({ turn: sent, actor: ana })),
    ]);

    expect(
      model.comments?.map((c): [string, string | null | undefined] => [c.id, c.sentInTurnId])
    ).toEqual([
      ["c1", "t2"],
      ["c2", null],
    ]);
    expect(model.turns.at(-1)?.turn.actor).toEqual(ana);
  });
});
