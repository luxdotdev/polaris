/**
 * Comments in the transcript (Paper SS1): "N comments" folded under a message, the author
 * of each prompt in a shared session, and the Comments a Turn carried, quoted in its prompt.
 */
import { Actor } from "@polaris/protocol";
import { cn, DisclosureChevron } from "@polaris/ui";
import { useState } from "react";
import { useCommentDraft } from "../../data/session.ts";
import { anchorPlace, actorName, messageComments, turnAuthorLabel } from "../../model/session.ts";
import { useSessionComments } from "./hooks.ts";
import { CommentList, DraftEditor, PersonAvatar, ReplyField, replyAnchor } from "./parts.tsx";

interface Where {
  readonly hostKey: string;
  readonly sessionId: string;
}

const OWNER = Actor.cases.Client.make({});

const plural = (n: number) => `${n} ${n === 1 ? "comment" : "comments"}`;

/** "Sent with turn 25" when every Comment went with the same Turn. */
const sentTogether = (
  turnIds: ReadonlyArray<string | null | undefined>,
  turnNumber: (id: string | null | undefined) => number | null
) => {
  const first = turnIds[0];
  const n = turnNumber(first);

  return n !== null && turnIds.every((id) => id === first) ? `Sent with turn ${n}` : null;
};

/** Under a message: its Comments folded to one line, and the owner's draft on it. */
export const MessageComments = ({
  hostKey,
  sessionId,
  messageId,
}: Where & { messageId: string }) => {
  const scope = useSessionComments(hostKey, sessionId);
  const draft = useCommentDraft(hostKey, sessionId);
  const [open, setOpen] = useState(false);
  const comments = messageComments(scope.comments, messageId);

  const drafting =
    draft?.anchor.kind === "message" && draft.anchor.messageId === messageId ? draft : null;

  if (comments.length === 0 && drafting === null) return null;
  const first = comments[0];
  const quote = first === undefined ? "" : first.anchor.quote;
  const shown = open || drafting !== null;

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="message-comments">
      {first === undefined ? null : (
        <div className="rounded-row border-hairline bg-surface-raised flex flex-col border">
          <button
            type="button"
            className="gap-gap flex h-8 min-w-0 cursor-default items-center px-3 text-left"
            aria-expanded={shown}
            onClick={() => setOpen(!shown)}
          >
            <DisclosureChevron open={shown} size={10} className="text-text-subtle" />
            <span className="text-caption text-text-strong shrink-0 font-medium">
              {plural(comments.length)}
            </span>
            <span className="text-caption text-text-subtle min-w-0 truncate">on “{quote}”</span>
            <span className="flex-1" />
            <span className="text-caption text-text-subtle shrink-0">
              {sentTogether(
                comments.map((c) => c.sentInTurnId),
                scope.turnNumber
              )}
            </span>
          </button>
          {shown ? (
            <div className="border-hairline flex flex-col gap-3 border-t p-3">
              <CommentList comments={comments} scope={scope} />
              {scope.shared ? <ReplyField scope={scope} anchor={replyAnchor(first)} /> : null}
            </div>
          ) : null}
        </div>
      )}
      {drafting === null ? null : <DraftEditor scope={scope} />}
    </div>
  );
};

/** A prompt's sender, in a session that is or was shared (DESIGN.md, rule/solo-is-unchanged). */
export const TurnAuthor = ({
  hostKey,
  sessionId,
  actor: sender,
}: Where & { actor: Actor | null }) => {
  const { shared } = useSessionComments(hostKey, sessionId);

  if (!shared) return null;
  const actor = sender ?? OWNER;

  return (
    <div className="gap-gap flex items-center" data-testid="turn-author">
      <PersonAvatar actor={actor} size={16} />
      <span className="text-caption text-text-default font-medium">{turnAuthorLabel(actor)}</span>
    </div>
  );
};

/** The Comments a Turn carried, as quoted cards above its prompt: author, then where. */
export const QuotedComments = ({
  hostKey,
  sessionId,
  ids,
}: Where & { ids: ReadonlyArray<string> }) => {
  const scope = useSessionComments(hostKey, sessionId);

  if (ids.length === 0) return null;

  const byId = new Map<string, (typeof scope.comments)[number]>(
    scope.comments.map((c) => [c.id, c])
  );

  const carried = ids.flatMap((id) => byId.get(id) ?? []);

  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="quoted-comments">
      {carried.map((c) => (
        <div
          key={c.id}
          className="rounded-row bg-surface-sunken flex min-w-0 flex-col gap-1 px-3 py-2"
        >
          <div className="gap-gap flex min-w-0 items-center">
            <PersonAvatar actor={c.author} size={16} />
            <span className="text-caption text-text-strong shrink-0 font-medium">
              {actorName(c.author)}
            </span>
            <span className={cn("text-caption text-text-subtle min-w-0 truncate")}>
              {anchorPlace(c, scope.harnessName)}
            </span>
          </div>
          <p className="text-body text-text-default break-words whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
    </div>
  );
};
