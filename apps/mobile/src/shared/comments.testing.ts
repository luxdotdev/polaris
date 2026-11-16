/** Comments and Actors for the shared-session tests. */
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  PersonId,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import { at, sessionId } from "../thread/daemon.testing.ts";

export const maya = Actor.cases.Teammate.make({
  shareId: ShareId.make("share-1"),
  personId: PersonId.make("p-maya"),
  name: "Maya Chen",
});

export const owner = Actor.cases.Client.make({});

export const onMessage = (turn: string, messageId: string, quote = "Starting on variant 4.") =>
  CommentAnchor.cases.MessageText.make({
    turnId: TurnId.make(turn),
    messageId,
    start: 0,
    end: quote.length,
    quote,
  });

export const onLines = (turn: string, path: string, start = 4, end = start) =>
  CommentAnchor.cases.DiffLines.make({
    turnId: TurnId.make(turn),
    path,
    side: "new",
    start,
    end,
    code: "const token = readFile()",
  });

export const comment = (
  id: string,
  anchor: CommentAnchor,
  fields: Partial<ConstructorParameters<typeof Comment>[0]> = {}
) =>
  new Comment({
    id: CommentId.make(id),
    sessionId,
    anchor,
    body: `body of ${id}`,
    author: maya,
    createdAt: at,
    ...fields,
  });
