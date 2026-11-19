/**
 * Line Comments in the Changes lane (Paper SS1): the shown Turn's threads under their lines,
 * the owner's draft, and a line number that opens a draft there once the session is shared.
 * The whole session's diff places only the latest Turn's new-side lines (ENG-977); the rest
 * are counted, with a link to their Turn.
 */
import { Button, cn } from "@polaris/ui";
import { Predicate } from "effect";
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
import type { SessionComment } from "../../../store/sessionComments.ts";
import { commentMark, type DiffRow, lineSide } from "../diffRows.ts";
import type { DiffLine } from "../model/diff.ts";
import { plural } from "../model/format.ts";
import { groupOf, type TurnGroup } from "../model/turnGroups.ts";

interface ChangesComments {
  readonly hostKey: string;
  readonly sessionId: string;
  /** The Turn a new Comment anchors to: the last of the group shown, whose diff this is. */
  readonly turnId: string;
  readonly shared: boolean;
  readonly threads: ReadonlyMap<string, LineThread>;
  /** Where Comment rows go (`commentMark`): threads and the open draft. */
  readonly marks: ReadonlySet<string>;
  /** The whole session's diff: its old side is the session's start, so no draft opens there. */
  readonly whole: boolean;
  /** Line Comments the diff can't place, by their Turn, oldest first. */
  readonly elsewhere: ReadonlyArray<{ readonly group: TurnGroup; readonly count: number }>;
}

type Anchor = { readonly turnId: string; readonly side: "new" | "old" };

/** Whether a Comment on `anchor` sits on the diff shown: its Turns, and only the new side if whole. */
const placed = (anchor: Anchor, ids: ReadonlySet<string>, whole: boolean) =>
  ids.has(anchor.turnId) && (!whole || anchor.side === "new");

/** The line Comments not placed, counted by their Turn. */
const unplaced = (
  comments: ReadonlyArray<SessionComment>,
  groups: ReadonlyArray<TurnGroup>
): ChangesComments["elsewhere"] => {
  const counts = new Map<TurnGroup, number>();

  for (const c of comments) {
    const group = groupOf(groups, c.anchor.turnId);

    if (group !== undefined) counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  return [...counts]
    .map(([group, count]) => ({ group, count }))
    .toSorted((a, b) => a.group.number - b.group.number);
};

const Context = createContext<ChangesComments | null>(null);

const NO_MARKS: ReadonlySet<string> = new Set();

export const useChangesMarks = () => useContext(Context)?.marks ?? NO_MARKS;

export const ChangesCommentsProvider = ({
  hostKey,
  sessionId,
  group,
  whole,
  groups,
  children,
}: {
  hostKey: string;
  sessionId: string;
  /** The Turn shown, or the latest when `whole`: new Comments anchor to its last Turn. */
  group: TurnGroup | null;
  whole: boolean;
  groups: ReadonlyArray<TurnGroup>;
  children: ReactNode;
}) => {
  const scope = useSessionComments(hostKey, sessionId);
  const draft = useCommentDraft(hostKey, sessionId)?.anchor;

  const value = useMemo((): ChangesComments | null => {
    const last = group?.views.at(-1)?.turn.id;

    if (group === null || last === undefined) return null;
    const ids = new Set<string>(group.views.map((v) => v.turn.id));
    const lines = scope.comments.filter((c) => Predicate.isTagged(c.anchor, "DiffLines"));

    const shown = lines.filter(
      (c) => Predicate.isTagged(c.anchor, "DiffLines") && placed(c.anchor, ids, whole)
    );

    const rest = lines.filter((c) => !shown.includes(c));

    const threads = new Map(
      lineThreads(shown).map((t) => [commentMark(t.path, t.side, t.line), t])
    );

    const marks = new Set(threads.keys());

    if (draft?.kind === "lines" && placed(draft, ids, whole))
      marks.add(commentMark(draft.path, draft.side, draft.end));

    return {
      hostKey,
      sessionId,
      turnId: last,
      shared: scope.shared,
      threads,
      marks,
      whole,
      elsewhere: unplaced(rest, groups),
    };
  }, [hostKey, sessionId, group, whole, groups, scope.comments, scope.shared, draft]);

  return <Context value={value}>{children}</Context>;
};

/** The line number; in a shared session a click opens the owner's draft on that line. */
export const LineNumber = ({ path, line }: { path: string; line: DiffLine }) => {
  const ctx = useContext(Context);
  const at = lineSide(line);
  const label = line.newNumber ?? "";

  if (ctx === null || !ctx.shared || at === null || (ctx.whole && at.side === "old"))
    return <>{label}</>;

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

/** The whole session's Comments it can't place: a count, and a link to each one's Turn. */
export const CommentsElsewhere = ({ onPick }: { onPick: (turnId: string) => void }) => {
  const elsewhere = useContext(Context)?.elsewhere ?? [];
  const total = elsewhere.reduce((sum, e) => sum + e.count, 0);

  if (total === 0) return null;

  return (
    <div
      className="text-caption text-text-subtle flex flex-wrap items-center gap-1 px-4 pt-3"
      data-testid="comments-elsewhere"
    >
      <span>{plural(total, "comment")} on their turn only:</span>
      {elsewhere.map(({ group }) => (
        <Button key={group.id} variant="ghost" size="sm" onClick={() => onPick(group.id)}>
          Turn {group.number}
        </Button>
      ))}
    </div>
  );
};
