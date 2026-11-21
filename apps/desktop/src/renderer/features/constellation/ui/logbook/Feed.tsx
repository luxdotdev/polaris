/**
 * The Logbook with no Task selected (Paper L2): every Task's entries, newest first, one line
 * each, the id in its state's tone, and a tally under the title. ↵ opens that Task's Logbook.
 */
import { cn, Kbd } from "@polaris/ui";
import { Predicate } from "effect";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useRef } from "react";
import { span } from "../../model/copy.ts";
import {
  authorWord,
  type EntryData,
  feedText,
  kindWord,
  type TallyState,
  tallyOf,
  verdictWord,
} from "../../model/logbook.ts";
import type { TaskRow } from "../../model/index.ts";
import { ConstellationMark } from "../glyphs.tsx";
import { ID_TONE } from "../rows.tsx";

const TALLY_TONE: Readonly<Partial<Record<TallyState, string>>> = {
  "needs-you": "text-needs-you-text",
  done: "text-accepted-text",
};

/** Which tally a Task counts under, from the rail's own look. */
export const tallyState = (row: TaskRow): TallyState | null => {
  const { bucket } = row.look;

  if (bucket === "waiting") return row.projection.state === "ready" ? "ready" : null;

  return bucket === "ended" ? null : bucket;
};

export const FeedHeader = ({
  name,
  tasks,
}: {
  readonly name: string;
  readonly tasks: ReadonlyArray<TaskRow>;
}) => {
  const tally = tallyOf(tasks.map(tallyState));

  return (
    <header
      className="border-hairline px-panel flex shrink-0 flex-col gap-1 border-b pt-3 pb-2.5"
      data-testid="logbook-feed-header"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ConstellationMark size={14} />
        <h2 className="text-heading-sm text-text-strong min-w-0 truncate">{name}</h2>
        <span className="text-caption text-text-faint shrink-0">all tasks · newest first</span>
      </div>
      <p className="text-caption text-text-subtle flex flex-wrap gap-x-1 pl-[22px]">
        {tally.map(({ state, text }, n) => (
          <span key={state} className={TALLY_TONE[state]}>
            {text}
            {n === tally.length - 1 ? "" : " ·"}
          </span>
        ))}
      </p>
    </header>
  );
};

const FeedLine = ({ entry }: { readonly entry: EntryData }) => {
  if (Predicate.isTagged(entry, "Inspection"))
    return (
      <>
        <span className="text-text-strong font-medium">{verdictWord(entry)}</span> {entry.text}
      </>
    );

  if (Predicate.isTagged(entry, "Lost"))
    return <span className="text-failed-text">{feedText(entry)}</span>;

  if (Predicate.isTagged(entry, "Question") && entry.question.to === "user")
    return (
      <>
        <span className="text-needs-you-text">Asks you:</span> {entry.text}
      </>
    );

  return <>{feedText(entry)}</>;
};

interface LineProps {
  readonly entry: EntryData;
  /** The id's tone class, from its Task's state. */
  readonly tone: string;
  /** "2m", "1h 5m": changes only when the minute does. */
  readonly age: string;
  readonly on: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (taskId: string) => void;
}

/** One line; it re-renders only when its own props change, not per page or cursor move. */
const Line = memo(({ entry, tone, age, on, onSelect, onOpen }: LineProps) => {
  const author = authorWord(entry);

  return (
    <div
      role="option"
      aria-selected={on}
      data-entry={entry.id}
      tabIndex={-1}
      onClick={() => onSelect(entry.id)}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen(entry.taskId) : undefined)}
      onDoubleClick={() => onOpen(entry.taskId)}
      className={cn(
        "rounded-control text-caption group/line px-gap flex h-[26px] min-w-0 items-center",
        on ? "bg-fill-selected/60" : "hover:bg-fill-hover/60"
      )}
    >
      <span className="text-micro text-text-faint w-14 shrink-0 font-mono">{age}</span>
      <span className={cn("text-micro w-12 shrink-0 truncate font-mono", tone)}>
        {entry.taskId}
      </span>
      <span
        className={cn(
          "w-[76px] shrink-0 truncate",
          author.id ? "text-text-subtle font-mono" : "text-text-subtle",
          entry.author === "you" && "text-text-default"
        )}
      >
        {author.text}
      </span>
      <span className="text-micro text-text-faint w-[84px] shrink-0 truncate font-mono">
        {kindWord(entry)}
      </span>
      <span className="text-body text-text-default min-w-0 grow truncate">
        <FeedLine entry={entry} />
      </span>
      {on ? (
        <span className="text-text-faint ml-2 flex shrink-0 items-center gap-1">
          Open {entry.taskId} <Kbd variant="plain">↵</Kbd>
        </span>
      ) : null}
    </div>
  );
});

const LINE = 26;

/** Before layout (and in tests) the list assumes a pane this size. */
const FIRST_RECT = { width: 720, height: 640 };

/** Callbacks that keep their identity, so memoized lines don't re-render when they change. */
const useStable = <A extends ReadonlyArray<unknown>>(fn: (...args: A) => void) => {
  const latest = useRef(fn);

  useEffect(() => {
    latest.current = fn;
  });

  return useCallback((...args: A) => latest.current(...args), []);
};

export const Feed = ({
  entries,
  tasks,
  selected,
  now,
  onSelect,
  onOpen,
}: {
  readonly entries: ReadonlyArray<EntryData>;
  readonly tasks: ReadonlyMap<string, TaskRow>;
  readonly selected: string | null;
  readonly now: number;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (taskId: string) => void;
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const select = useStable(onSelect);
  const open = useStable(onOpen);

  // oxlint-disable-next-line react/incompatible-library -- the Desktop's one list virtualizer, as every long list uses
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => LINE,
    getItemKey: (index) => entries[index]?.id ?? index,
    initialRect: FIRST_RECT,
    overscan: 12,
    paddingStart: 6,
    paddingEnd: 6,
  });

  const cursorAt = selected === null ? -1 : entries.findIndex((e) => e.id === selected);

  useEffect(() => {
    if (cursorAt >= 0) virtualizer.scrollToIndex(cursorAt, { align: "auto" });
  }, [cursorAt, virtualizer]);

  if (entries.length === 0)
    return (
      <div className="text-body text-text-subtle px-panel grid flex-1 place-items-center text-center">
        No entries yet. Briefs, progress, claims, reviews and notes from every task land here.
      </div>
    );

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Entries across tasks"
      className="px-gap min-h-0 grow overflow-y-auto overscroll-contain"
      data-testid="logbook-feed"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];

          if (entry === undefined) return null;

          return (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Line
                entry={entry}
                tone={ID_TONE[tasks.get(entry.taskId)?.look.idTone ?? "neutral"]}
                age={span(entry.at, now)}
                on={entry.id === selected}
                onSelect={select}
                onOpen={open}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
