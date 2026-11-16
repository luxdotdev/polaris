/**
 * The decider's Comment commands (ADR 0113): adding, editing, resolving and reopening a
 * Comment of a session, each recorded with its Actor. They change no Session State; the
 * `comment` Grant is checked at the gate (`COMMAND_GRANTS`, `SHARE_COMMANDS`).
 */
import {
  type Command,
  Comment,
  type CommentAnchor,
  type CommentId,
  DomainEvent,
  mayResolveComment,
  sameActor,
  type Turn,
} from "@polaris/protocol";
import { Match, Result } from "effect";
import { commentsOf } from "../store/comments.ts";
import type { SessionRecord } from "../store/model.ts";
import type { Decision, Deciding } from "./decider.ts";

type CommandOf<Tag extends Command["_tag"]> = Extract<Command, { _tag: Tag }>;

/** Why `anchor` can't be a Comment's in `record`, or null when it can. */
const anchorRefusal = (
  record: SessionRecord,
  anchor: CommentAnchor,
  namedTurn: Turn | null
): string | null => {
  const turn =
    record.turns.find((t) => t.id === anchor.turnId) ??
    (namedTurn?.id === anchor.turnId && namedTurn.sessionId === record.session.id
      ? namedTurn
      : undefined);

  if (turn === undefined) return `Turn ${anchor.turnId} is not one of this session's`;
  const first = Match.valueTags(anchor, { DiffLines: () => 1, MessageText: () => 0 });

  if (!(anchor.start >= first && anchor.end >= anchor.start)) return "the anchor's range is empty";

  return null;
};

const addComment = (d: Deciding, command: CommandOf<"AddComment">): Decision =>
  d.withSession(command.sessionId, (record) => {
    if (command.body.trim() === "") return d.reject("the Comment is empty");

    for (const other of d.model.sessions.values())
      if (commentsOf(other).has(command.commentId))
        return d.reject(`Comment ${command.commentId} already exists`);
    const refusal = anchorRefusal(record, command.anchor, d.ctx.namedTurn);

    if (refusal !== null) return d.reject(refusal);

    return d.ok(
      DomainEvent.cases.CommentAdded.make({
        comment: new Comment({
          id: command.commentId,
          sessionId: command.sessionId,
          anchor: command.anchor,
          body: command.body,
          author: d.ctx.actor,
          createdAt: d.ctx.now,
          editedAt: null,
          resolvedAt: null,
          resolvedBy: null,
          sentInTurnId: null,
          outdatedInTurnId: null,
        }),
      })
    );
  });

const withComment = (
  d: Deciding,
  command: { readonly sessionId: Comment["sessionId"]; readonly commentId: CommentId },
  f: (comment: Comment) => Decision
): Decision =>
  d.withSession(command.sessionId, (record) => {
    const comment = commentsOf(record).get(command.commentId);

    return comment === undefined ? d.notFound("comment", command.commentId) : f(comment);
  });

const editComment = (d: Deciding, command: CommandOf<"EditComment">): Decision =>
  withComment(d, command, (comment) => {
    if (!sameActor(comment.author, d.ctx.actor)) return d.reject("only its author edits a Comment");

    if (comment.sentInTurnId != null) return d.reject("the Comment was already sent");

    if (command.body.trim() === "") return d.reject("the Comment is empty");

    return d.ok(
      DomainEvent.cases.CommentEdited.make({
        sessionId: command.sessionId,
        commentId: command.commentId,
        body: command.body,
        actor: d.ctx.actor,
      })
    );
  });

const setResolved = (
  d: Deciding,
  command: CommandOf<"ResolveComment"> | CommandOf<"ReopenComment">,
  resolved: boolean
): Decision =>
  withComment(d, command, (comment) => {
    if (!mayResolveComment(comment, d.ctx.actor, d.ctx.shareRole ?? null))
      return d.reject("only its author, the session's owner or a Contributor resolves a Comment");

    if ((comment.resolvedAt != null) === resolved)
      return d.reject(resolved ? "the Comment is already resolved" : "the Comment is not resolved");

    const fields = {
      sessionId: command.sessionId,
      commentId: command.commentId,
      actor: d.ctx.actor,
    };

    return d.ok(
      resolved
        ? DomainEvent.cases.CommentResolved.make(fields)
        : DomainEvent.cases.CommentReopened.make(fields)
    );
  });

export const commentDeciders = (d: Deciding) => ({
  AddComment: (c: CommandOf<"AddComment">) => addComment(d, c),
  EditComment: (c: CommandOf<"EditComment">) => editComment(d, c),
  ResolveComment: (c: CommandOf<"ResolveComment">) => setResolved(d, c, true),
  ReopenComment: (c: CommandOf<"ReopenComment">) => setResolved(d, c, false),
});

/**
 * The Comments a `SendFeedback` carries, in its order, or why it can't: an unknown one,
 * another session's, one already sent, or one named twice.
 */
export const carriedComments = (
  d: Deciding,
  record: SessionRecord,
  ids: ReadonlyArray<CommentId>
): Result.Result<ReadonlyArray<Comment>, string> => {
  const comments: Array<Comment> = [];

  for (const id of ids) {
    const comment = commentsOf(record).get(id);

    if (comment === undefined) {
      const elsewhere = [...d.model.sessions.values()].some((r) => commentsOf(r).has(id));

      return Result.fail(
        elsewhere ? `Comment ${id} is another session's` : `there is no Comment ${id}`
      );
    }

    if (comment.sentInTurnId != null)
      return Result.fail(`Comment ${id} was already sent with Turn ${comment.sentInTurnId}`);

    if (comments.includes(comment)) return Result.fail(`Comment ${id} is named twice`);
    comments.push(comment);
  }

  return Result.succeed(comments);
};
