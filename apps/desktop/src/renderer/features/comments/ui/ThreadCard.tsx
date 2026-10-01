/**
 * A pull request's review thread (Paper R6 8FR-0): its comments, drafts marked "Pending ·
 * Goes out with your review", a reply field (a reply during a pending review joins it, as
 * on GitHub), resolve and unresolve. Resolved threads fold to one line, as on GitHub.
 */
import { Button, cn, SeverityGlyph, Textarea } from "@polaris/ui";
import { useState } from "react";
import type { ReviewCommentView, ReviewThreadView } from "../../../../shared/github.ts";
import { deleteComment, type Done, reply, resolveThread } from "../data/actions.ts";
import { openComposer, useComments } from "../data/store.ts";
import { useThreadLink } from "../data/links.ts";
import { suggestionBlock } from "../model/composer.ts";
import { isDraft } from "../model/threads.ts";
import { ANNOTATION_INSET, surfaceOf } from "../../review/index.ts";
import { Avatar } from "./Avatar.tsx";

interface Props {
  readonly subjectKey: string;
  readonly threadId: string;
  /** "inline" sits under its line in the diff; "list" in the risk column. */
  readonly variant?: "inline" | "list";
  /** Extra actions for a listed thread (an outdated draft's "Move to selection"). */
  readonly extra?: React.ReactNode;
}

const Comment = ({
  comment,
  viewer,
  onDiscard,
}: {
  readonly comment: ReviewCommentView;
  readonly viewer: string | null;
  readonly onDiscard: (() => void) | null;
}) => {
  const mine = comment.author !== null && comment.author === viewer;
  const name = mine ? "You" : (comment.author ?? "Someone");

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="thread-comment"
      data-pending={comment.pending ? "" : undefined}
    >
      <div className="gap-gap flex items-center">
        <Avatar name={comment.author ?? "?"} />
        <span className="text-body text-text-strong font-medium">{name}</span>
        {comment.pending && (
          <span className="bg-fill-selected text-text-subtle text-micro rounded-[5px] px-1.5 py-px font-medium">
            Pending
          </span>
        )}
        <span className="flex-1" />
        {comment.pending ? (
          <span className="text-caption text-text-subtle">Goes out with your review</span>
        ) : null}
        {onDiscard !== null && (
          <Button size="xs" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        )}
      </div>
      <p className="text-body text-text-default break-words whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
};

const ReplyBox = ({ subjectKey, threadId, onDone }: Props & { readonly onDone: () => void }) => {
  const [text, setText] = useState("");

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const send = async () => {
    if (text.trim() === "" || state.busy) return;
    setState({ busy: true, error: null });
    const done: Done = await reply(subjectKey, threadId, text);

    if (done.ok) onDone();
    else setState({ busy: false, error: done.message });
  };

  return (
    <div className="border-hairline rounded-control bg-surface-sunken flex flex-col gap-1.5 border p-2">
      <Textarea
        bare
        autoFocus
        rows={1}
        aria-label="Reply"
        placeholder="Reply"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
          else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
      />
      {state.error !== null && <p className="text-caption text-failed-text">{state.error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="primary"
          disabled={text.trim() === "" || state.busy}
          onClick={() => void send()}
        >
          Reply <span className="opacity-60">⌘↵</span>
        </Button>
      </div>
    </div>
  );
};

const Folded = ({
  thread,
  onOpen,
}: {
  readonly thread: ReviewThreadView;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    onClick={onOpen}
    className="text-caption text-text-subtle hover:bg-fill-hover rounded-row border-hairline gap-gap flex h-8 w-full cursor-default items-center border px-3"
  >
    {thread.isResolved ? "Resolved" : "Outdated"} · {thread.comments.length}{" "}
    {thread.comments.length === 1 ? "comment" : "comments"}
    <span className="flex-1" />
    <span className="text-text-subtle">Show</span>
  </button>
);

/** Paper R6's arrow for "Suggest change" on a pending comment. */
const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 8h9M8 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/**
 * A pending comment's footer (Paper R6 8FR-0): "Suggest change" reopens it in the composer
 * with a suggestion block, replacing the draft; "Linked to ▲ …" names the finding it answers.
 */
const DraftFooter = ({
  subjectKey,
  threadId,
  thread,
}: Props & { readonly thread: ReviewThreadView }) => {
  const link = useThreadLink(threadId);
  const first = thread.comments[0];

  if (thread.anchor.kind !== "line" || first === undefined) return null;
  const { anchor } = thread;

  const suggest = () => {
    const range = {
      path: thread.path,
      side: anchor.side === "left" ? ("old" as const) : ("new" as const),
      start: anchor.startLine ?? anchor.line,
      end: anchor.line,
    };

    const code = surfaceOf(subjectKey).quote?.(range) ?? "";

    openComposer(
      subjectKey,
      { ...range, code },
      { text: `${first.body}\n${suggestionBlock(code)}`, moving: first.id }
    );
  };

  return (
    <>
      <Button size="xs" variant="secondary" className="px-2" onClick={suggest}>
        <ArrowIcon />
        Suggest change
      </Button>
      {link !== undefined && (
        <span className="text-caption text-text-subtle flex min-w-0 items-center gap-1">
          Linked to
          <SeverityGlyph severity={link.severity} tone="text" />
          <span className="truncate">{link.title}</span>
        </span>
      )}
    </>
  );
};

const Body = ({
  subjectKey,
  threadId,
  thread,
  extra,
}: Props & { readonly thread: ReviewThreadView }) => {
  const viewer = useComments((s) => s.pulls[subjectKey]?.detail?.viewerLogin ?? null);
  const [replying, setReplying] = useState(false);
  const draft = isDraft(thread);

  return (
    <div className="rounded-row bg-surface-raised border-hairline gap-row-x flex flex-col border p-3">
      {thread.comments.map((comment) => (
        <Comment
          key={comment.id}
          comment={comment}
          viewer={viewer}
          onDiscard={comment.pending ? () => void deleteComment(subjectKey, comment.id) : null}
        />
      ))}
      {replying ? (
        <ReplyBox subjectKey={subjectKey} threadId={threadId} onDone={() => setReplying(false)} />
      ) : (
        <div className="flex items-center gap-1.5">
          {draft && thread.anchor.kind === "line" && (
            <DraftFooter subjectKey={subjectKey} threadId={threadId} thread={thread} />
          )}
          {!draft && (
            <Button size="xs" variant="secondary" onClick={() => setReplying(true)}>
              Reply
            </Button>
          )}
          {!draft && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void resolveThread(subjectKey, threadId, !thread.isResolved)}
            >
              {thread.isResolved ? "Unresolve" : "Resolve"}
            </Button>
          )}
          {extra}
        </div>
      )}
    </div>
  );
};

export const ThreadCard = ({ subjectKey, threadId, variant = "inline", extra }: Props) => {
  const thread = useComments((s) =>
    s.pulls[subjectKey]?.detail?.threads.find((t) => t.id === threadId)
  );

  const [open, setOpen] = useState(false);

  if (thread === undefined) return null;

  const folds =
    (thread.isResolved || (thread.isOutdated && !thread.comments.some((c) => c.pending))) && !open;

  return (
    <div
      data-testid="review-thread"
      data-thread={threadId}
      className={cn(
        "flex font-sans",
        variant === "inline" ? cn("py-gap", ANNOTATION_INSET) : "py-1"
      )}
    >
      <div className="min-w-0 flex-1">
        {folds ? (
          <Folded thread={thread} onOpen={() => setOpen(true)} />
        ) : (
          <Body subjectKey={subjectKey} threadId={threadId} thread={thread} extra={extra} />
        )}
      </div>
    </div>
  );
};
