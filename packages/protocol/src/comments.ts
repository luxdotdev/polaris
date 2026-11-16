/**
 * Comments (CONTEXT.md: Comment; ADR 0113): notes anchored to a diff line range or to
 * text in a message, kept as events in the Agent Session's log and folded into its state.
 * A Comment reaches the agent only when someone sends it as a Turn (`SendFeedback.commentIds`).
 * Capability `session.comments`; Clients that announced it get them in the session snapshot.
 */
import { Predicate, Schema } from "effect";
import { Actor } from "./extensions.ts";
import { CommentId, SessionId, Timestamp, TurnId } from "./ids.ts";
import { optionalNullable } from "./models.ts";
import { diffLinesLabel, LineRange, quotedNote } from "./review.ts";
import type { ShareRole } from "./shares.ts";

/**
 * What a Comment is about. It never moves: when a later Turn changes the anchored code,
 * Clients show the Comment as outdated (`code` and `quote` are what it was written against).
 */
export const CommentAnchor = Schema.TaggedUnion({
  /** Lines of `path` in `turnId`'s diff: 1-based, inclusive, on its new or old side. */
  DiffLines: {
    turnId: TurnId,
    path: Schema.String,
    side: Schema.Literals(["new", "old"]),
    start: Schema.Int,
    end: Schema.Int,
    /** The quoted code, as the diff showed it. */
    code: Schema.String,
  },
  /** Characters `start` (inclusive) to `end` (exclusive) of the message item `messageId`. */
  MessageText: {
    turnId: TurnId,
    /** The `TurnItem.id` of the message. */
    messageId: Schema.String,
    start: Schema.Int,
    end: Schema.Int,
    /** The quoted text, as the message showed it. */
    quote: Schema.String,
  },
});

export type CommentAnchor = typeof CommentAnchor.Type;

/** A Comment as the session's events fold it. */
export class Comment extends Schema.Class<Comment>("Comment")({
  id: CommentId,
  sessionId: SessionId,
  anchor: CommentAnchor,
  body: Schema.String,
  /** Who added it; kept when someone else sends it as a Turn. */
  author: Actor,
  createdAt: Timestamp,
  editedAt: optionalNullable(Timestamp),
  resolvedAt: optionalNullable(Timestamp),
  resolvedBy: optionalNullable(Actor),
  /** The Turn that carried it to the agent (`SendFeedback.commentIds`); null until sent. */
  sentInTurnId: optionalNullable(TurnId),
  /**
   * The later Turn that changed the lines a `DiffLines` Comment is anchored to: Clients show
   * it as outdated, where it was written. Null while they stand.
   */
  outdatedInTurnId: optionalNullable(TurnId),
}) {}

/** The Comment events of the session's log (`events.ts`); each records its Actor. */
export const commentEventFields = {
  /** `AddComment`: `comment.author` is who added it. */
  CommentAdded: { comment: Comment },
  /** `EditComment`: only its author edits a Comment. */
  CommentEdited: {
    sessionId: SessionId,
    commentId: CommentId,
    body: Schema.String,
    actor: Actor,
  },
  CommentResolved: { sessionId: SessionId, commentId: CommentId, actor: Actor },
  CommentReopened: { sessionId: SessionId, commentId: CommentId, actor: Actor },
  /** The Host found that `turnId` changed a `DiffLines` Comment's anchored lines. */
  CommentOutdated: { sessionId: SessionId, commentId: CommentId, turnId: TurnId },
};

/** Whether two Actors are the same one: the same Pairing, Linked Device or person. */
export const sameActor = (a: Actor, b: Actor): boolean =>
  Actor.match(a, {
    Client: () => Predicate.isTagged(b, "Client"),
    Extension: (x) => Predicate.isTagged(b, "Extension") && b.pairingId === x.pairingId,
    LinkedDevice: (x) => Predicate.isTagged(b, "LinkedDevice") && b.deviceId === x.deviceId,
    Teammate: (x) => Predicate.isTagged(b, "Teammate") && b.personId === x.personId,
  });

/**
 * Whether `actor` may resolve or reopen `comment` (ADR 0113): its author, the owner (any
 * Actor that is not a Teammate), or a Contributor. `role` is the acting Teammate's Share role.
 */
export const mayResolveComment = (
  comment: Comment,
  actor: Actor,
  role: ShareRole | null
): boolean =>
  !Predicate.isTagged(actor, "Teammate") ||
  role === "contributor" ||
  sameActor(comment.author, actor);

const anchorLabel = (anchor: CommentAnchor): string =>
  CommentAnchor.match(anchor, {
    DiffLines: (a) =>
      diffLinesLabel(a.path, new LineRange({ start: a.start, end: a.end, side: a.side })),
    MessageText: () => "From a message",
  });

/** Who a Comment is credited to in the Turn that carries it: the owner's own Clients are "the owner". */
export const commentAuthorName = (author: Actor): string =>
  Actor.match(author, {
    Client: () => "the owner",
    Extension: (a) => a.name,
    LinkedDevice: () => "the owner",
    Teammate: (a) => a.name,
  });

const anchorQuote = (anchor: CommentAnchor): string =>
  CommentAnchor.match(anchor, { DiffLines: (a) => a.code, MessageText: (a) => a.quote });

/**
 * The prompt `SendFeedback` sends for Comments: the message, then each Comment's anchor and
 * author, quoted text and body, as `feedbackPrompt` renders drafts. Clients preview the Turn with it.
 */
export const commentsPrompt = (
  message: string | null,
  comments: ReadonlyArray<Comment>
): string => {
  const parts: Array<string> = [];

  if (message !== null && message.trim() !== "") parts.push(message.trim());

  for (const comment of comments)
    parts.push(
      quotedNote(
        `${anchorLabel(comment.anchor)} (comment by ${commentAuthorName(comment.author)})`,
        anchorQuote(comment.anchor),
        comment.body
      )
    );

  return parts.join("\n\n");
};
