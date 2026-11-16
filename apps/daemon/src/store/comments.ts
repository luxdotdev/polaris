/**
 * Comments in the read model (ADR 0113): each session's, folded from its Comment events and
 * from the Turns that carry them (`Turn.commentIds`). They change no Session State.
 */
import {
  Comment,
  type CommentId,
  type DomainEvent,
  type SessionId,
  type Turn,
} from "@polaris/protocol";
import { Match } from "effect";
import type { ReadModel, SessionRecord } from "./model.ts";

const NONE: ReadonlyMap<CommentId, Comment> = new Map();

/** The session's Comments, in the order they were added. */
export const commentsOf = (record: SessionRecord): ReadonlyMap<CommentId, Comment> =>
  record.comments ?? NONE;

type CommentPatch = Partial<typeof Comment.Type>;

/** A copy of `comment` with `patch` applied. */
export const patchComment = (comment: Comment, patch: CommentPatch): Comment =>
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
    ...patch,
  });

const withComments = (
  model: ReadModel,
  sessionId: SessionId,
  f: (comments: ReadonlyMap<CommentId, Comment>) => ReadonlyMap<CommentId, Comment>
): ReadModel => {
  const record = model.sessions.get(sessionId);

  if (record === undefined) return model;
  const before = commentsOf(record);
  const comments = f(before);

  if (comments === before) return model;
  const sessions = new Map(model.sessions);

  sessions.set(sessionId, { ...record, comments });

  return { ...model, sessions };
};

const patchOne = (
  model: ReadModel,
  sessionId: SessionId,
  commentId: CommentId,
  patch: (comment: Comment) => CommentPatch
): ReadModel =>
  withComments(model, sessionId, (comments) => {
    const comment = comments.get(commentId);

    if (comment === undefined) return comments;
    const next = new Map(comments);

    next.set(commentId, patchComment(comment, patch(comment)));

    return next;
  });

export type CommentEvent = Extract<
  DomainEvent,
  {
    readonly _tag:
      | "CommentAdded"
      | "CommentEdited"
      | "CommentResolved"
      | "CommentReopened"
      | "CommentOutdated";
  }
>;

/** Fold one Comment event, recorded `at`. */
export const foldComment = (model: ReadModel, event: CommentEvent, at: string): ReadModel =>
  Match.valueTags(event, {
    CommentAdded: ({ comment }) =>
      withComments(model, comment.sessionId, (comments) =>
        comments.has(comment.id) ? comments : new Map([...comments, [comment.id, comment]])
      ),
    CommentEdited: (e) =>
      patchOne(model, e.sessionId, e.commentId, () => ({ body: e.body, editedAt: at })),
    CommentResolved: (e) =>
      patchOne(model, e.sessionId, e.commentId, () => ({ resolvedAt: at, resolvedBy: e.actor })),
    CommentReopened: (e) =>
      patchOne(model, e.sessionId, e.commentId, () => ({ resolvedAt: null, resolvedBy: null })),
    CommentOutdated: (e) =>
      patchOne(model, e.sessionId, e.commentId, (comment) => ({
        outdatedInTurnId: comment.outdatedInTurnId ?? e.turnId,
      })),
  });

/** A `SendFeedback` Turn starting: each Comment it carries is sent with it. */
export const carriedBy = (model: ReadModel, turn: Turn): ReadModel => {
  const ids = turn.commentIds ?? [];

  return ids.reduce(
    (folded, id) =>
      patchOne(folded, turn.sessionId, id, (comment) => ({
        sentInTurnId: comment.sentInTurnId ?? turn.id,
      })),
    model
  );
};
