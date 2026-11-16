import { describe, expect, test } from "bun:test";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  PersonId,
  SessionId,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import { coAuthorTrailers, contributors, withTrailers } from "./trailers.ts";

const teammate = (name: string, share = name) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${share}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const OWNER = Actor.cases.Client.make({});

const comment = (id: string, author: Actor) =>
  new Comment({
    id: CommentId.make(id),
    sessionId: SessionId.make("s"),
    anchor: CommentAnchor.cases.MessageText.make({
      turnId: TurnId.make("t1"),
      messageId: "m",
      start: 0,
      end: 1,
      quote: "x",
    }),
    body: "note",
    author,
    createdAt: "2026-11-16T00:00:00.000Z",
  });

const turn = (id: string, commentIds: ReadonlyArray<string> = []) => ({
  id: TurnId.make(id),
  commentIds: commentIds.map((c) => CommentId.make(c)),
});

describe("contributors", () => {
  test("Turn senders and sent Comments' authors count, once per person; the owner never does", () => {
    const ana = teammate("Ana");
    const bob = teammate("Bob");
    const anaElsewhere = teammate("Ana", "constellation");

    const comments = new Map([
      [CommentId.make("c-bob"), comment("c-bob", bob)],
      [CommentId.make("c-owner"), comment("c-owner", OWNER)],
      [CommentId.make("c-ana"), comment("c-ana", anaElsewhere)],
      [CommentId.make("c-unsent"), comment("c-unsent", teammate("Cleo"))],
    ]);

    const actors = new Map<TurnId, Actor>([
      [TurnId.make("t1"), OWNER],
      [TurnId.make("t2"), ana],
    ]);

    const people = contributors(
      [turn("t1", ["c-owner"]), turn("t2"), turn("t3", ["c-bob", "c-ana"])],
      actors,
      comments
    );

    expect(people.map((p) => p.name)).toEqual(["Ana", "Bob"]);
    expect(contributors([turn("t1", ["c-owner"])], actors, comments)).toEqual([]);
  });
});

describe("coAuthorTrailers", () => {
  test("one line per email, case-insensitively; no email, no line; names can't break the line", () => {
    expect(
      coAuthorTrailers([
        { name: "Ana Lima", email: "ana@work.example" },
        null,
        { name: "Ana again", email: "ANA@work.example" },
        { name: "", email: "bob@x.example" },
        { name: "Eve <evil>\nSigned-off-by: x", email: "eve@x.example" },
        { name: "Nobody", email: "  " },
      ])
    ).toEqual([
      "Co-authored-by: Ana Lima <ana@work.example>",
      "Co-authored-by: bob@x.example <bob@x.example>",
      "Co-authored-by: Eve evil Signed-off-by: x <eve@x.example>",
    ]);
  });
});

describe("withTrailers", () => {
  const ana = "Co-authored-by: Ana <ana@work.example>";
  const bob = "Co-authored-by: Bob <bob@x.example>";

  test.each([
    ["a title alone", "Add the parser\n", "Add the parser\n\n" + ana + "\n" + bob + "\n"],
    ["a body", "Add the parser\n\nIt parses.", `Add the parser\n\nIt parses.\n\n${ana}\n${bob}`],
    [
      "its own trailer block",
      "Add the parser\n\nSigned-off-by: Me <me@x.example>\n",
      `Add the parser\n\nSigned-off-by: Me <me@x.example>\n${ana}\n${bob}\n`,
    ],
    ["an empty body", "", `${ana}\n${bob}`],
    [
      "one already there, in another case",
      "Fix\n\nco-authored-by: Ana L <ANA@work.example>\n",
      `Fix\n\nco-authored-by: Ana L <ANA@work.example>\n${bob}\n`,
    ],
  ])("adds the missing trailers after %s", (_, message, expected) => {
    expect(withTrailers(message, [ana, bob])).toBe(expected);
  });

  test("a message with every trailer, or none to add, stays as it was", () => {
    const message = `Fix\n\n${ana}\n${bob}\n`;
    expect(withTrailers(message, [bob, ana])).toBe(message);
    expect(withTrailers("Fix\n", [])).toBe("Fix\n");
  });
});
