import { describe, expect, test } from "bun:test";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  PairingId,
  SessionId,
  TurnId,
} from "@polaris/protocol";
import { lineThreads, quoteRange, turnAuthorLabel } from "./session.ts";

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

    expect(turnAuthorLabel(raycast)).toBe("from Raycast");
    expect(turnAuthorLabel(Actor.cases.Client.make({}))).toBe("You");
  });
});
