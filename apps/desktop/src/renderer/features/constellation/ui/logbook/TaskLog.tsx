/**
 * One Task's Logbook (Paper L1, L3): its header, then entries oldest first by Attempt, earlier
 * Attempts folded to their boundary and verdict. It keeps to the bottom while new entries land.
 */
import { cn, Kbd } from "@polaris/ui";
import { useLayoutEffect, useRef, useState } from "react";
import type { Facts } from "../../model/facts.ts";
import {
  type AttemptMark,
  type AttemptSection,
  type EntryData,
  entryCaption,
  foldedByDefault,
  type LogbookLog,
  timelineOf,
} from "../../model/logbook.ts";
import type { TaskRow } from "../../model/index.ts";
import { ConstellationMark, TaskGlyph } from "../glyphs.tsx";
import { ID_TONE, TONE } from "../rows.tsx";
import { Boundary, checksOf, EntryRow } from "./entries.tsx";

const VERDICT = new Set<EntryData["_tag"]>(["Review", "Inspection", "Lost"]);

/** A folded Attempt keeps the entry that settled it in view. */
const shownWhenFolded = (section: AttemptSection) => {
  const last = section.entries.at(-1);

  return last !== undefined && VERDICT.has(last._tag) ? [last] : [];
};

export const TaskHeader = ({
  row,
  constellation,
  current,
}: {
  readonly row: TaskRow;
  readonly constellation: string;
  /** The Task's latest boundary in its Logbook, which numbers Attempts as the Daemon does. */
  readonly current: AttemptMark | null;
}) => {
  const { task, attempt } = row;
  const area = task.area ?? [];

  return (
    <header
      className="border-hairline px-panel flex shrink-0 flex-col gap-1 border-b pt-2.5 pb-3"
      data-testid="logbook-header"
    >
      <div className="text-caption flex h-4 min-w-0 items-center gap-1.5">
        <ConstellationMark size={12} />
        <span className="text-text-subtle shrink-0">{constellation}</span>
        {task.group == null ? null : (
          <span className="text-text-faint min-w-0 truncate">› {task.group}</span>
        )}
        <span className="grow" />
        <Kbd>esc</Kbd>
        <span className="text-text-faint shrink-0">all tasks</span>
      </div>
      <div className="flex h-6 min-w-0 items-center gap-2.5">
        <TaskGlyph glyph={row.look.glyph} harness={row.harness} size={12} />
        <span className={cn("text-caption shrink-0 font-mono", ID_TONE[row.look.idTone])}>
          {task.id}
        </span>
        <h2 className="text-text-strong min-w-0 grow truncate text-[15px] leading-5 font-medium">
          {task.title}
        </h2>
        <span className={cn("text-caption shrink-0", TONE[row.look.wordTone])}>
          {row.look.word}
        </span>
      </div>
      {attempt === null ? null : (
        <p className="text-caption text-text-subtle truncate pl-5">
          attempt {current?.number ?? row.attemptNumber}
          {row.actor === "" ? "" : ` · ${row.actor}`}
        </p>
      )}
      {area.length === 0 && attempt === null ? null : (
        <p className="text-caption text-text-faint gap-gap flex min-w-0 items-center pl-5">
          {area.length === 0 ? null : (
            <>
              <span className="shrink-0">Area</span>
              <span className="text-micro text-text-subtle min-w-0 truncate font-mono">
                {area.join(" ")}
              </span>
            </>
          )}
          {attempt === null ? null : (
            <>
              <span className="shrink-0">{area.length === 0 ? "branch" : "· branch"}</span>
              <span className="text-micro text-text-subtle min-w-0 shrink truncate font-mono">
                {attempt.branch}
              </span>
            </>
          )}
        </p>
      )}
    </header>
  );
};

/** Stays pinned to the newest entry unless the reader scrolled up. */
const useStickToEnd = (count: number, taskId: string) => {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    pinned.current = true;
  }, [taskId]);

  useLayoutEffect(() => {
    const el = ref.current;

    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, taskId]);

  const onScroll = () => {
    const el = ref.current;

    if (el !== null) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return { ref, onScroll };
};

export const TaskLog = ({
  taskId,
  log,
  facts,
}: {
  readonly taskId: string;
  readonly log: LogbookLog;
  readonly facts: Facts;
}) => {
  const timeline = timelineOf(log, taskId);
  const [open, setOpen] = useState<ReadonlyMap<string, boolean>>(new Map());

  const count =
    timeline.before.length + timeline.sections.reduce((n, s) => n + s.entries.length, 0);

  const { ref, onScroll } = useStickToEnd(count, taskId);
  const current = timeline.sections.at(-1)?.attempt.attemptId ?? null;

  if (count === 0 && timeline.sections.length === 0)
    return (
      <div className="text-body text-text-subtle px-panel grid flex-1 place-items-center text-center">
        Nothing in {taskId}'s logbook yet. Its brief and every claim, review and note land here.
      </div>
    );

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-label={`${taskId}'s logbook`}
      className="pr-panel pl-gap flex min-h-0 grow flex-col overflow-y-auto overscroll-contain"
      data-testid="logbook-entries"
    >
      <div className="grow" />
      <div className="py-1.5">
        {timeline.before.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            caption={entryCaption(entry, log)}
            checks={checksOf(entry, facts)}
            last={false}
          />
        ))}
        {timeline.sections.map((section) => {
          const id = section.attempt.attemptId;
          const folded = !(open.get(id) ?? !foldedByDefault(timeline, id));
          const shown = folded ? shownWhenFolded(section) : section.entries;

          return (
            <section key={id} aria-label={`Attempt ${section.attempt.number}`}>
              <Boundary
                attempt={section.attempt}
                current={id === current}
                hidden={section.entries.length - shown.length}
                onShow={() => setOpen((m) => new Map(m).set(id, true))}
              />
              {shown.map((entry, n) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  caption={entryCaption(entry, log)}
                  checks={checksOf(entry, facts)}
                  last={n === shown.length - 1}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
};
