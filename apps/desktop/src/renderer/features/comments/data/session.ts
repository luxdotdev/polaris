/**
 * An Agent Session's Comments as commands (ADR 0113): the draft being written on this device
 * (one per session, private until posted), posting it, resolving, and sending Comments as a Turn.
 */
import { CommentAnchor, CommentId, type SessionId, type TurnId } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { Commands } from "../../../commands.ts";
import { sessionKey } from "../../../store/store.ts";
import { dispatch, refusalText } from "../../session/dispatch.ts";
import type { Done } from "./actions.ts";

/** Where the owner's draft is: a message's text or a file's lines. */
export type DraftAnchor =
  | {
      readonly kind: "message";
      readonly turnId: string;
      readonly messageId: string;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
    }
  | {
      readonly kind: "lines";
      readonly turnId: string;
      readonly path: string;
      readonly side: "new" | "old";
      readonly start: number;
      readonly end: number;
      readonly code: string;
    };

export interface CommentDraft {
  readonly anchor: DraftAnchor;
  readonly text: string;
  readonly busy: boolean;
  readonly error: string | null;
}

interface DraftsState {
  readonly drafts: Readonly<Record<string, CommentDraft>>;
}

const drafts = createStore<DraftsState>(() => ({ drafts: {} }));

export const useCommentDraft = (hostKey: string, sessionId: string): CommentDraft | undefined =>
  useStore(drafts, (s) => s.drafts[sessionKey(hostKey, sessionId)]);

const setDraft = (key: string, draft: CommentDraft | null) =>
  drafts.setState((s) => {
    const next = { ...s.drafts };

    if (draft === null) delete next[key];
    else next[key] = draft;

    return { drafts: next };
  });

/** Opens a draft at `anchor`; one already there keeps its text. */
export const openCommentDraft = (hostKey: string, sessionId: string, anchor: DraftAnchor) => {
  const key = sessionKey(hostKey, sessionId);
  const current = drafts.getState().drafts[key];
  const same = current !== undefined && JSON.stringify(current.anchor) === JSON.stringify(anchor);

  setDraft(key, { anchor, text: same ? current.text : "", busy: false, error: null });
};

export const editCommentDraft = (hostKey: string, sessionId: string, text: string) => {
  const key = sessionKey(hostKey, sessionId);
  const current = drafts.getState().drafts[key];

  if (current !== undefined) setDraft(key, { ...current, text, error: null });
};

export const discardCommentDraft = (hostKey: string, sessionId: string) =>
  setDraft(sessionKey(hostKey, sessionId), null);

const anchorOf = (anchor: DraftAnchor): CommentAnchor =>
  anchor.kind === "message"
    ? CommentAnchor.cases.MessageText.make({
        // SAFETY: the anchor was taken from a Turn this session's feed sent.
        turnId: anchor.turnId as TurnId,
        messageId: anchor.messageId,
        start: anchor.start,
        end: anchor.end,
        quote: anchor.quote,
      })
    : CommentAnchor.cases.DiffLines.make({
        // SAFETY: as above, the Turn whose diff the lines are in.
        turnId: anchor.turnId as TurnId,
        path: anchor.path,
        side: anchor.side,
        start: anchor.start,
        end: anchor.end,
        code: anchor.code,
      });

const sent = (result: Awaited<ReturnType<typeof dispatch>>, hostKey: string): Done =>
  result.ok ? { ok: true } : { ok: false, message: refusalText(result.error, hostKey) };

/** Adds a Comment at `anchor` (a reply is a Comment on the same lines or text). */
export const addComment = async (
  hostKey: string,
  sessionId: string,
  anchor: DraftAnchor,
  body: string
): Promise<Done> =>
  sent(
    await dispatch(
      hostKey,
      Commands.AddComment({
        // SAFETY: the open session's id, from the Host.
        sessionId: sessionId as SessionId,
        commentId: CommentId.make(crypto.randomUUID()),
        anchor: anchorOf(anchor),
        body: body.trim(),
      })
    ),
    hostKey
  );

/** "Comment": posts the draft; it stays open with the Host's reason if refused. */
export const postCommentDraft = async (hostKey: string, sessionId: string): Promise<Done> => {
  const key = sessionKey(hostKey, sessionId);
  const draft = drafts.getState().drafts[key];

  if (draft === undefined || draft.busy || draft.text.trim() === "")
    return { ok: false, message: "Write a comment first" };
  setDraft(key, { ...draft, busy: true, error: null });
  const done = await addComment(hostKey, sessionId, draft.anchor, draft.text);

  setDraft(key, done.ok ? null : { ...draft, busy: false, error: done.message });

  return done;
};

export const setCommentResolved = async (
  hostKey: string,
  sessionId: string,
  commentId: string,
  resolved: boolean
): Promise<Done> => {
  // SAFETY: both ids come from the session's own feed.
  const ids = { sessionId: sessionId as SessionId, commentId: commentId as CommentId };

  return sent(
    await dispatch(hostKey, resolved ? Commands.ResolveComment(ids) : Commands.ReopenComment(ids)),
    hostKey
  );
};

/** Sends the chosen Comments as one Turn, in this order; each keeps its author. */
export const sendComments = async (
  hostKey: string,
  sessionId: string,
  commentIds: ReadonlyArray<string>
): Promise<Done> =>
  sent(
    await dispatch(
      hostKey,
      Commands.SendFeedback({
        // SAFETY: the open session's id and its Comments' ids, from the Host.
        sessionId: sessionId as SessionId,
        feedback: { message: null, comments: [] },
        attachments: [],
        // SAFETY: each id is a Comment of this session, from its feed.
        commentIds: commentIds.map((id) => id as CommentId),
      })
    ),
    hostKey
  );
