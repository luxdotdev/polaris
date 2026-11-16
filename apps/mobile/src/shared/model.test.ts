import { describe, expect, test } from "bun:test";
import {
  Actor,
  commentsPrompt,
  DomainEvent,
  LinkedDeviceId,
  PairingId,
  TurnId,
} from "@polaris/protocol";
import { applySessionItem, type SessionFold } from "../thread/fold.ts";
import { event, snapshot, turn } from "../thread/daemon.testing.ts";
import { promptMessage } from "./commands.ts";
import { comment, maya, onLines, onMessage, owner } from "./comments.testing.ts";
import {
  bylineOf,
  commentMarks,
  commenterNote,
  commentsLine,
  lineThreads,
  mayResolve,
  OWNER,
  showsSharing,
  stepComments,
  turnNumberOf,
  type Viewer,
} from "./model.ts";

const asMaya: Viewer = {
  kind: "teammate",
  personId: "p-maya",
  role: "commenter",
  ownerName: "Lucas Doell",
};

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    turn: turn(index),
    items: [],
    live: [],
    streaming: [],
  }));

describe("bylines", () => {
  test("a Teammate reads their own Turns as You and the owner's by the owner's name", () => {
    expect(bylineOf(maya, asMaya)).toEqual({ label: "You", initials: "MC" });
    expect(bylineOf(owner, asMaya)).toEqual({ label: "Lucas Doell", initials: "LD" });
  });

  test("the owner reads their phone and other Clients as You, a Teammate by name", () => {
    const phone = Actor.cases.LinkedDevice.make({
      deviceId: LinkedDeviceId.make("d-1"),
      name: "iPhone",
    });

    expect(bylineOf(phone, OWNER).label).toBe("You");
    expect(bylineOf(maya, OWNER).label).toBe("Maya Chen");
  });

  test("an Extension's Turn reads as from it", () => {
    const raycast = Actor.cases.Extension.make({
      pairingId: PairingId.make("x"),
      name: "Raycast",
    });

    expect(bylineOf(raycast, asMaya).label).toBe("from Raycast");
  });
});

describe("rule/solo-is-unchanged", () => {
  test("an owner's session nobody else touched shows nothing of sharing", () => {
    const own = comment("c1", onMessage("t-0", "m1"), { author: owner });

    expect(showsSharing(OWNER, entries(2), [own])).toBe(false);
  });

  test("a Teammate's Turn or Comment makes the session shared for the owner", () => {
    const turns = [{ ...entries(1)[0]!, turn: turn(0, { actor: maya }) }];

    expect(showsSharing(OWNER, turns, [])).toBe(true);
    expect(showsSharing(OWNER, entries(1), [comment("c1", onMessage("t-0", "m1"))])).toBe(true);
  });
});

describe("Comments", () => {
  const number = turnNumberOf(entries(30));

  test("marks say which Turn carried it, then outdated and resolved", () => {
    const sent = comment("c1", onLines("t-0", "src/serve.ts"), {
      sentInTurnId: TurnId.make("t-24"),
      outdatedInTurnId: TurnId.make("t-26"),
      resolvedAt: "2026-11-16T12:00:00.000Z",
    });

    expect(commentMarks(sent, number)).toEqual(["Sent with turn 25", "Outdated", "Resolved"]);
  });

  test("a message's line names the Turn only when one Turn carried them all", () => {
    const a = comment("a", onMessage("t-0", "m1"), { sentInTurnId: TurnId.make("t-24") });
    const b = comment("b", onMessage("t-0", "m1"), { sentInTurnId: TurnId.make("t-24") });
    const c = comment("c", onMessage("t-0", "m1"));

    expect(commentsLine([a, b], number)).toBe("2 comments · Sent with turn 25");
    expect(commentsLine([a, c], number)).toBe("2 comments");
    expect(commentsLine([c], number)).toBe("1 comment");
  });

  test("a step finds its file's line Comments though the Harness named the file absolutely", () => {
    const ours = comment("a", onLines("t-3", "src/serve.ts"));
    const otherTurn = comment("b", onLines("t-4", "src/serve.ts"));
    const otherFile = comment("c", onLines("t-3", "src/other.ts"));
    const lookalike = comment("d", onLines("t-3", "serve.ts"));

    const found = stepComments([ours, otherTurn, otherFile, lookalike], "t-3", [
      "/Users/maya/polaris/src/serve.ts",
    ]);

    expect(found.map((c) => String(c.id))).toEqual(["a", "d"]);
  });

  test("replies on the same lines are one thread, other lines another", () => {
    const threads = lineThreads([
      comment("a", onLines("t-3", "src/serve.ts", 4)),
      comment("b", onLines("t-3", "src/serve.ts", 9, 12)),
      comment("c", onLines("t-3", "src/serve.ts", 4)),
    ]);

    expect(threads.map((t) => [t.place, t.comments.map((c) => String(c.id))])).toEqual([
      ["serve.ts:4", ["a", "c"]],
      ["serve.ts:9–12", ["b"]],
    ]);
  });

  test("a Commenter resolves only their own Comments; a Contributor any", () => {
    const mine = comment("a", onMessage("t-0", "m1"));
    const owners = comment("b", onMessage("t-0", "m1"), { author: owner });

    expect(mayResolve(mine, asMaya)).toBe(true);
    expect(mayResolve(owners, asMaya)).toBe(false);
    expect(mayResolve(owners, { ...asMaya, role: "contributor" })).toBe(true);
  });

  test("a Commenter's composer names the owner by first name", () => {
    expect(commenterNote("Lucas Doell")).toBe(
      "As a commenter, you comment; turns come from Lucas and contributors."
    );
  });
});

describe("the fold", () => {
  const fold = (...items: Parameters<typeof applySessionItem>[1][]) =>
    items.reduce<SessionFold | null>(applySessionItem, null);

  test("a Comment added, then carried by a Turn, reads as sent with it", () => {
    const added = comment("c1", onMessage("t-0", "m1"));
    const carrier = turn(1, { commentIds: [added.id], status: "working" });

    const state = fold(
      snapshot([{ turn: turn(0) }]),
      event(2, DomainEvent.cases.CommentAdded.make({ comment: added })),
      event(3, DomainEvent.cases.TurnStarted.make({ turn: carrier }))
    );

    expect(state?.comments.map((c) => [String(c.id), c.sentInTurnId])).toEqual([["c1", "t-1"]]);
  });

  test("resolving and reopening a Comment comes back unresolved", () => {
    const added = comment("c1", onMessage("t-0", "m1"));
    const ids = { sessionId: added.sessionId, commentId: added.id };

    const state = fold(
      snapshot([{ turn: turn(0) }]),
      event(2, DomainEvent.cases.CommentAdded.make({ comment: added })),
      event(3, DomainEvent.cases.CommentResolved.make({ ...ids, actor: owner })),
      event(4, DomainEvent.cases.CommentReopened.make({ ...ids, actor: owner }))
    );

    expect(state?.comments[0]?.resolvedAt ?? null).toBeNull();
  });
});

describe("a Turn carrying Comments", () => {
  test("shows only its own message; the Comments are cards", () => {
    const carried = [
      comment("a", onMessage("t-0", "m1")),
      comment("b", onLines("t-0", "serve.ts")),
    ];

    const own = "Do both of these, then carry on with variant 4.";

    expect(promptMessage(commentsPrompt(own, carried), carried)).toBe(own);
    expect(promptMessage(commentsPrompt(null, carried), carried)).toBe("");
    expect(promptMessage("typed by hand", carried)).toBe("typed by hand");
  });
});
