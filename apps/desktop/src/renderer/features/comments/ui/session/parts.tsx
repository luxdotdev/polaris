/**
 * The pieces of a session's Comments (Paper SS1): an author's initials, one Comment with its
 * marks, the owner's draft ("You · Draft", Discard, Comment), and a thread with its reply field.
 */
import { Actor } from "@polaris/protocol";
import { Button, cn, Textarea } from "@polaris/ui";
import { Predicate } from "effect";
import { useState } from "react";
import { age } from "../../../../shell/copy.ts";
import { useNow } from "../../../../shell/useNow.ts";
import {
  addComment,
  discardCommentDraft,
  type DraftAnchor,
  editCommentDraft,
  postCommentDraft,
  setCommentResolved,
  useCommentDraft,
} from "../../data/session.ts";
import {
  type ActorViewer,
  actorName,
  commentMarks,
  OWN_SESSION,
  type SessionComment,
} from "../../model/session.ts";
import type { SessionComments } from "./hooks.ts";

const OWNER = Actor.cases.Client.make({});

/** Up to two initials in a circle (remote avatars wait for the main process's cache). */
export const PersonAvatar = ({
  actor,
  size = 20,
  viewer = OWN_SESSION,
}: {
  actor: Actor;
  size?: 16 | 20;
  /** Who is reading; your own session's when left out, which the draft's "You" uses. */
  viewer?: ActorViewer;
}) => {
  const initials = actorName(actor, viewer)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w.slice(0, 1))
    .join("");

  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-fill-selected text-text-subtle flex shrink-0 items-center justify-center rounded-full font-medium uppercase",
        size === 16 ? "size-4 text-[8px]" : "text-micro size-5"
      )}
    >
      {initials}
    </span>
  );
};

const CommentEntry = ({ comment, scope }: { comment: SessionComment; scope: SessionComments }) => {
  const now = useNow(60_000);
  const marks = commentMarks(comment, scope.turnNumber);
  const resolved = comment.resolvedAt != null;

  return (
    <div
      className="group/comment flex flex-col gap-1"
      data-testid="session-comment"
      data-comment-id={comment.id}
    >
      <div className="gap-gap flex min-w-0 items-center">
        <PersonAvatar actor={comment.author} viewer={scope.viewer} />
        <span className="text-body text-text-strong shrink-0 font-medium">
          {actorName(comment.author, scope.viewer)}
        </span>
        <span className="text-caption text-text-subtle min-w-0 truncate">
          {[age(comment.createdAt, now), ...marks].join(" · ")}
        </span>
        <span className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          className="opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
          onClick={() =>
            void setCommentResolved(scope.hostKey, scope.sessionId, comment.id, !resolved)
          }
        >
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
      <p
        className={cn(
          "text-body pl-7 break-words whitespace-pre-wrap",
          resolved ? "text-text-subtle" : "text-text-default"
        )}
      >
        {comment.body}
      </p>
    </div>
  );
};

/** A card in the transcript or a diff: hairline, raised, the row radius. */
export const CommentCard = ({
  children,
  testId,
  draft = false,
}: {
  children: React.ReactNode;
  testId: string;
  draft?: boolean;
}) => (
  <div
    className={cn(
      "rounded-row bg-surface-raised border-hairline flex min-w-0 flex-col gap-2.5 border p-3 font-sans",
      draft &&
        "shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-starlight)_40%,transparent),0_2px_8px_#0000000F]"
    )}
    data-testid={testId}
  >
    {children}
  </div>
);

export const CommentList = ({
  comments,
  scope,
}: {
  comments: ReadonlyArray<SessionComment>;
  scope: SessionComments;
}) => (
  <>
    {comments.map((c) => (
      <CommentEntry key={c.id} comment={c} scope={scope} />
    ))}
  </>
);

/** The owner's draft at its anchor: private to this device until "Comment" posts it. */
export const DraftEditor = ({ scope }: { scope: SessionComments }) => {
  const draft = useCommentDraft(scope.hostKey, scope.sessionId);

  if (draft === undefined) return null;
  const post = () => void postCommentDraft(scope.hostKey, scope.sessionId);
  const discard = () => discardCommentDraft(scope.hostKey, scope.sessionId);

  return (
    <CommentCard testId="comment-draft" draft>
      <div className="gap-gap flex items-center">
        <PersonAvatar actor={OWNER} />
        <span className="text-body text-text-strong font-medium">You</span>
        <span className="text-caption text-text-subtle">Draft</span>
      </div>
      <Textarea
        bare
        autoFocus
        rows={2}
        aria-label="Comment"
        className="max-h-60 min-h-10"
        placeholder="Leave a comment"
        value={draft.text}
        onChange={(e) => editCommentDraft(scope.hostKey, scope.sessionId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            discard();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            post();
          }
        }}
      />
      {draft.error === null ? null : <p className="text-caption text-failed-text">{draft.error}</p>}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={discard}>
          Discard
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={draft.busy || draft.text.trim() === ""}
          onClick={post}
          data-testid="comment-post"
        >
          Comment
        </Button>
      </div>
    </CommentCard>
  );
};

/** "Reply…": a Comment on the same anchor, posted at once. */
export const ReplyField = ({ scope, anchor }: { scope: SessionComments; anchor: DraftAnchor }) => {
  const [text, setText] = useState("");

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const send = async () => {
    if (text.trim() === "" || state.busy) return;
    setState({ busy: true, error: null });
    const done = await addComment(scope.hostKey, scope.sessionId, anchor, text);

    if (done.ok) setText("");
    setState({ busy: false, error: done.ok ? null : done.message });
  };

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        rows={1}
        aria-label="Reply"
        placeholder="Reply…"
        className="min-h-8"
        value={text}
        disabled={state.busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {state.error === null ? null : <p className="text-caption text-failed-text">{state.error}</p>}
    </div>
  );
};

/** A Comment's anchor as a draft anchor, so a reply lands in the same place. */
export const replyAnchor = ({ anchor }: SessionComment): DraftAnchor => {
  if (Predicate.isTagged(anchor, "MessageText")) {
    const { _tag, ...at } = anchor;

    return { kind: "message", ...at };
  }

  const { _tag, ...at } = anchor;

  return { kind: "lines", ...at };
};
