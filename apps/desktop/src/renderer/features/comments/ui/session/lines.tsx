/**
 * Line Comments in a diff (the Changes lane and Review show the same ones): a thread under
 * its last line with its reply field, and the owner's draft where it was opened.
 */
import { cn } from "@polaris/ui";
import { useCommentDraft } from "../../data/session.ts";
import type { LineThread } from "../../model/session.ts";
import { useSessionComments } from "./hooks.ts";
import { CommentCard, CommentList, DraftEditor, ReplyField, replyAnchor } from "./parts.tsx";

interface Where {
  readonly hostKey: string;
  readonly sessionId: string;
}

export const LineThreadCard = ({
  hostKey,
  sessionId,
  thread,
  className,
}: Where & { thread: LineThread; className?: string }) => {
  const scope = useSessionComments(hostKey, sessionId);
  const first = thread.comments[0];

  if (first === undefined) return null;

  return (
    <div className={cn("py-1.5", className)}>
      <CommentCard testId="line-thread">
        <CommentList comments={thread.comments} scope={scope} />
        {scope.shared ? <ReplyField scope={scope} anchor={replyAnchor(first)} /> : null}
      </CommentCard>
    </div>
  );
};

/** The owner's draft on lines, when it is on `path` at `line`'s side. */
export const LineDraft = ({
  hostKey,
  sessionId,
  path,
  side,
  line,
  className,
}: Where & { path: string; side: "new" | "old"; line: number; className?: string }) => {
  const scope = useSessionComments(hostKey, sessionId);
  const draft = useCommentDraft(hostKey, sessionId);
  const anchor = draft?.anchor;

  if (
    anchor?.kind !== "lines" ||
    anchor.path !== path ||
    anchor.side !== side ||
    anchor.end !== line
  )
    return null;

  return (
    <div className={cn("py-1.5", className)}>
      <DraftEditor scope={scope} />
    </div>
  );
};
