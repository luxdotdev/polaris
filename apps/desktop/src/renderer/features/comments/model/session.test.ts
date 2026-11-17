import { describe, expect, test } from "bun:test";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  PairingId,
  PersonId,
  SessionId,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import { actorName, lineThreads, OWN_SESSION, quoteRange, turnAuthorLabel } from "./session.ts";

const lines = (id: string, path: string, end: number, side: "new" | "old" = "new") =>
  new Comment({
    id: CommentId.make(id),
    sessionId: SessionId.make("s1"),
    anchor: CommentAnchor.cases.DiffLines.make({
      turnId: TurnId.make("t1"),
      path,
      side,
      start: end - 1,
      end,
      code: "",
    }),
    body: "",
    author: Actor.cases.Client.make({}),
    createdAt: "2026-11-16T10:00:00.000Z",
  });

describe("session Comments", () => {
  test("line Comments thread by file, side and last line, oldest first", () => {
    const threads = lineThreads([
      lines("a", "src/a.ts", 4),
      lines("b", "src/b.ts", 4),
      lines("c", "src/a.ts", 4),
      lines("d", "src/a.ts", 4, "old"),
    ]);

    expect(
      threads.map((t) => [t.path, t.side, t.line, t.comments.map((c): string => c.id)])
    ).toEqual([
      ["src/a.ts", "new", 4, ["a", "c"]],
      ["src/b.ts", "new", 4, ["b"]],
      ["src/a.ts", "old", 4, ["d"]],
    ]);
  });

  test("a selection maps back to the message's text through its markdown", () => {
    const text = "Use **bold** words\nand `code` here";

    expect(quoteRange(text, "bold words")).toEqual({ start: 6, end: 18 });
    expect(quoteRange(text, "words and code")).toEqual({ start: 13, end: 28 });
    expect(quoteRange(text, "not in it")).toBeNull();
  });

  test("an Extension's Turn reads as from it; the owner's as You", () => {
    const raycast = Actor.cases.Extension.make({
      pairingId: PairingId.make("p1"),
      name: "Raycast",
    });

    expect(turnAuthorLabel(raycast, OWN_SESSION)).toBe("from Raycast");
    expect(turnAuthorLabel(Actor.cases.Client.make({}), OWN_SESSION)).toBe("You");
  });

  test("on a session shared with you, the owner goes by name and only your own Turns are You", () => {
    const teammate = (personId: string, name: string) =>
      Actor.cases.Teammate.make({
        shareId: ShareId.make("sh1"),
        personId: PersonId.make(personId),
        name,
      });

    const owner = Actor.cases.Client.make({});
    const theirs = { owner: "The Octocat", selfPersonId: "p-hubot" };
    const actors = [owner, teammate("p-hubot", "Hubot"), teammate("p-maya", "Maya")];

    expect(actors.map((a) => turnAuthorLabel(a, theirs))).toEqual(["The Octocat", "You", "Maya"]);
    expect(actors.map((a) => actorName(a, theirs))).toEqual(["The Octocat", "You", "Maya"]);
    // The owner's own screen: they are You, and every Teammate goes by name.
    expect(actors.map((a) => actorName(a, OWN_SESSION))).toEqual(["You", "Hubot", "Maya"]);
  });
});
