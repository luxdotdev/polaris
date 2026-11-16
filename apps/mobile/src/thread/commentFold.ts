/**
 * An Agent Session's Comments (ADR 0113) as the thread folds them: the Snapshot's list, then each
 * Comment event, and the sent mark a starting Turn's `commentIds` sets.
 */
import { Comment, type DomainEvent, type Turn } from "@polaris/protocol";
import { Match } from "effect";

type Comments = ReadonlyArray<Comment>;

const patch = (comments: Comments, id: string, change: (comment: Comment) => Comment): Comments =>
  comments.map((c) => (c.id === id ? change(c) : c));

const copy = (comment: Comment, fields: Partial<Comment>): Comment =>
  new Comment({
    id: comment.id,
    sessionId: comment.sessionId,
    anchor: comment.anchor,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    resolvedAt: comment.resolvedAt,
    resolvedBy: comment.resolvedBy,
    sentInTurnId: comment.sentInTurnId,
    outdatedInTurnId: comment.outdatedInTurnId,
    ...fields,
  });

/** Marks the Comments a starting Turn carried as sent with it. */
const sentWith = (comments: Comments, turn: Turn): Comments => {
  const ids = new Set<string>(turn.commentIds ?? []);

  return ids.size === 0
    ? comments
    : comments.map((c) => (ids.has(c.id) ? copy(c, { sentInTurnId: turn.id }) : c));
};

/** `comments` after `event`, which happened `at`; the same array for events that change none. */
export const foldComments = (comments: Comments, event: DomainEvent, at: string): Comments =>
  Match.value(event).pipe(
    Match.tags({
      CommentAdded: ({ comment }) => [...comments.filter((c) => c.id !== comment.id), comment],
      CommentEdited: ({ commentId, body }) =>
        patch(comments, commentId, (c) => copy(c, { body, editedAt: at })),
      CommentResolved: ({ commentId, actor }) =>
        patch(comments, commentId, (c) => copy(c, { resolvedAt: at, resolvedBy: actor })),
      CommentReopened: ({ commentId }) =>
        patch(comments, commentId, (c) => copy(c, { resolvedAt: null, resolvedBy: null })),
      CommentOutdated: ({ commentId, turnId }) =>
        patch(comments, commentId, (c) =>
          c.outdatedInTurnId == null ? copy(c, { outdatedInTurnId: turnId }) : c
        ),
      TurnStarted: ({ turn }) => sentWith(comments, turn),
    }),
    Match.orElse(() => comments)
  );
