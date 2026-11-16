/**
 * An Agent Session's Comments (ADR 0113) as the renderer folds them: the snapshot's list,
 * then each Comment event, and the sent mark a Turn's `commentIds` sets.
 */
import type { Comment, DomainEvent, EventEnvelope, Turn } from "@polaris/protocol";
import { Match } from "effect";
import type { Plain } from "./plain.ts";

export type SessionComment = Plain<Comment>;

type Comments = ReadonlyArray<SessionComment>;

const patch = (
  comments: Comments,
  id: string,
  change: (comment: SessionComment) => SessionComment
): Comments => comments.map((c) => (c.id === id ? change(c) : c));

/** Marks the Comments a starting Turn carried as sent with it. */
const sentWith = (comments: Comments, turn: Turn): Comments => {
  const ids = new Set<string>(turn.commentIds ?? []);

  return ids.size === 0
    ? comments
    : comments.map((c) => (ids.has(c.id) ? { ...c, sentInTurnId: turn.id } : c));
};

/** `comments` after `envelope`; the same array for events that change none. */
export const foldComments = (comments: Comments, envelope: EventEnvelope): Comments => {
  const at = envelope.occurredAt;

  return Match.value<DomainEvent>(envelope.event).pipe(
    Match.tags({
      CommentAdded: ({ comment }) => [...comments.filter((c) => c.id !== comment.id), comment],
      CommentEdited: ({ commentId, body }) =>
        patch(comments, commentId, (c) => ({ ...c, body, editedAt: at })),
      CommentResolved: ({ commentId, actor }) =>
        patch(comments, commentId, (c) => ({ ...c, resolvedAt: at, resolvedBy: actor })),
      CommentReopened: ({ commentId }) =>
        patch(comments, commentId, (c) => ({ ...c, resolvedAt: null, resolvedBy: null })),
      CommentOutdated: ({ commentId, turnId }) =>
        patch(comments, commentId, (c) =>
          c.outdatedInTurnId == null ? { ...c, outdatedInTurnId: turnId } : c
        ),
      TurnStarted: ({ turn }) => sentWith(comments, turn),
    }),
    Match.orElse(() => comments)
  );
};
