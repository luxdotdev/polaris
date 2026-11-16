/**
 * What the phone sends about Comments (ADR 0113): a new one on a message or a diff thread,
 * resolving and reopening, and the unsent ones as a Turn. Also the carrying Turn's own message,
 * and who is watching (`shares.watchPresence`) as avatars.
 */
import {
  Command,
  type Comment,
  CommentAnchor,
  CommentId,
  commentsPrompt,
  FeedbackBatch,
  type SessionId,
  type SharePresenceEntry,
  TurnId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { bylineOf, type Viewer } from "./model.ts";

let made = 0;

/** Client-made and unique across sessions, as the Host requires. */
export const newCommentId = (): CommentId => {
  made++;

  return CommentId.make(
    `mobile-c-${Date.now().toString(36)}-${made}-${Math.random().toString(36).slice(2, 10)}`
  );
};

/** A Comment on a whole message: the phone comments on what it shows, not a selection. */
export const messageAnchor = (turnId: string, messageId: string, text: string): CommentAnchor =>
  CommentAnchor.cases.MessageText.make({
    turnId: TurnId.make(turnId),
    messageId,
    start: 0,
    end: text.length,
    quote: text,
  });

export const addComment = (sessionId: SessionId, anchor: CommentAnchor, body: string) =>
  Command.cases.AddComment.make({
    sessionId,
    commentId: newCommentId(),
    anchor,
    body: body.trim(),
  });

export const resolveComment = (comment: Comment, resolve: boolean) =>
  resolve
    ? Command.cases.ResolveComment.make({ sessionId: comment.sessionId, commentId: comment.id })
    : Command.cases.ReopenComment.make({ sessionId: comment.sessionId, commentId: comment.id });

/** One Turn carrying `comments`, in order, with no message of its own. */
export const sendComments = (sessionId: SessionId, comments: ReadonlyArray<Comment>) =>
  Command.cases.SendFeedback.make({
    sessionId,
    feedback: new FeedbackBatch({ message: null, comments: [] }),
    attachments: [],
    commentIds: comments.map((c) => c.id),
  });

/**
 * The carrying Turn's own message: its prompt less the quoted Comments `commentsPrompt` added,
 * which show as cards; the whole prompt when it doesn't end with them.
 */
export const promptMessage = (prompt: string, carried: ReadonlyArray<Comment>): string => {
  if (carried.length === 0) return prompt;
  const notes = commentsPrompt(null, carried);

  if (prompt === notes) return "";

  return prompt.endsWith(`\n\n${notes}`) ? prompt.slice(0, -(notes.length + 2)) : prompt;
};

export interface Face {
  readonly key: string;
  readonly initials: string;
  /** "Maya Chen", for VoiceOver. */
  readonly label: string;
}

/** Who has the session open: the owner once however many devices, then each Teammate. */
export const presenceFaces = (
  entries: ReadonlyArray<SharePresenceEntry>,
  viewer: Viewer
): ReadonlyArray<Face> => {
  const faces = new Map<string, Face>();

  for (const entry of entries) {
    const teammate = Predicate.isTagged(entry.actor, "Teammate") ? entry.actor : null;
    const key = teammate === null ? "owner" : teammate.personId;
    const byline = bylineOf(entry.actor, viewer);
    const name = teammate?.name ?? (viewer.kind === "teammate" ? viewer.ownerName : "You");

    if (!faces.has(key))
      faces.set(key, {
        key,
        initials: byline.initials === "" ? "You" : byline.initials,
        label: name,
      });
  }

  return [...faces.values()];
};
