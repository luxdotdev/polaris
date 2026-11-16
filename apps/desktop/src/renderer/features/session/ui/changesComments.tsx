/**
 * Line Comments in the Changes lane (Paper SS1): the shown Turn's threads under their lines,
 * the owner's draft, and a line number that opens a draft there once the session is shared.
 */
import { cn } from "@polaris/ui";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  LineDraft,
  LineThreadCard,
  type LineThread,
  lineThreads,
  openCommentDraft,
  useCommentDraft,
  useSessionComments,
} from "../../comments/index.ts";
import { commentMark, type DiffRow, lineSide } from "../diffRows.ts";
import type { DiffLine } from "../model/diff.ts";
import type { TurnGroup } from "../model/turnGroups.ts";

interface ChangesComments {
  readonly hostKey: string;
  readonly sessionId: string;
  /** The Turn a new Comment anchors to: the last of the group shown, whose diff this is. */
  readonly turnId: string;
  readonly shared: boolean;
  readonly threads: ReadonlyMap<string, LineThread>;
  /** Where Comment rows go (`commentMark`): threads and the open draft. */
  readonly marks: ReadonlySet<string>;
}

const Context = createContext<ChangesComments | null>(null);

const NO_MARKS: ReadonlySet<string> = new Set();

export const useChangesMarks = () => useContext(Context)?.marks ?? NO_MARKS;

export const ChangesCommentsProvider = ({
  hostKey,
  sessionId,
  group,
  children,
}: {
  hostKey: string;
  sessionId: string;
  group: TurnGroup | null;
  children: ReactNode;
}) => {
  const scope = useSessionComments(hostKey, sessionId);
  const draft = useCommentDraft(hostKey, sessionId)?.anchor;

  const value = useMemo((): ChangesComments | null => {
    const last = group?.views.at(-1)?.turn.id;

    if (group === null || last === undefined) return null;
    const ids = new Set<string>(group.views.map((v) => v.turn.id));
    const shown = scope.comments.filter((c) => ids.has(c.anchor.turnId));

    const threads = new Map(
      lineThreads(shown).map((t) => [commentMark(t.path, t.side, t.line), t])
    );

    const marks = new Set(threads.keys());

    if (draft?.kind === "lines" && ids.has(draft.turnId))
      marks.add(commentMark(draft.path, draft.side, draft.end));

    return { hostKey, sessionId, turnId: last, shared: scope.shared, threads, marks };
  }, [hostKey, sessionId, group, scope.comments, scope.shared, draft]);

  return <Context value={value}>{children}</Context>;
};

/** The line number; in a shared session a click opens the owner's draft on that line. */
export const LineNumber = ({ path, line }: { path: string; line: DiffLine }) => {
  const ctx = useContext(Context);
  const at = lineSide(line);
  const label = line.newNumber ?? "";

  if (ctx === null || !ctx.shared || at === null) return <>{label}</>;

  return (
    <button
      type="button"
      title="Comment on this line"
      className="hover:text-text-strong w-full cursor-default text-right"
      onClick={() =>
        openCommentDraft(ctx.hostKey, ctx.sessionId, {
          kind: "lines",
          turnId: ctx.turnId,
          path,
          side: at.side,
          start: at.line,
          end: at.line,
          code: line.text,
        })
      }
    >
      {label}
    </button>
  );
};

/** A Comment row in the lane: the thread at its line, then the draft opened there. */
export const CommentsRow = ({
  row,
  path,
  card,
}: {
  row: Extract<DiffRow, { kind: "comments" }>;
  path: string;
  card: string;
}) => {
  const ctx = useContext(Context);

  if (ctx === null) return null;
  const thread = ctx.threads.get(commentMark(path, row.side, row.line));
  const where = { hostKey: ctx.hostKey, sessionId: ctx.sessionId };

  return (
    <div className={cn(card, "px-2.5 font-sans")} data-testid="changes-comments">
      {thread === undefined ? null : <LineThreadCard {...where} thread={thread} />}
      <LineDraft {...where} path={path} side={row.side} line={row.line} />
    </div>
  );
};
