/**
 * The Logbook tab in a Lead's Output (DESIGN.md, Logbook; ADR 0119). It follows the Task
 * selected on the rail; with none, it is the feed across Tasks. Esc returns to all Tasks.
 */
import { MessageTarget, TaskId } from "@polaris/protocol";
import { Kbd } from "@polaris/ui";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useCommands } from "../../../../shell/hooks.ts";
import { constellationCommands } from "../../client.ts";
import { useFacts } from "../../hooks.ts";
import { type LogbookFeed, useLogbook } from "../../logbookFeed.ts";
import { buildRail, type ConstellationRecord, type TaskRow } from "../../model/index.ts";
import { emptyLog, feedOf } from "../../model/logbook.ts";
import { leadKey, patchLeadUi, useLeadUi } from "../../state.ts";
import { Composer } from "./Composer.tsx";
import { Feed, FeedHeader } from "./Feed.tsx";
import { TaskHeader, TaskLog } from "./TaskLog.tsx";

export interface LogbookTabProps {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
}

/** The Task the rail has selected, if it is one this tab can show. */
export const selectedTask = (selected: string | null, rows: ReadonlyMap<string, TaskRow>) => {
  const id = selected?.startsWith("task:") === true ? selected.slice(5) : null;

  return id === null ? null : (rows.get(id) ?? null);
};

const Hints = ({ keys }: { readonly keys: ReadonlyArray<readonly [string, string]> }) => (
  <div className="text-caption text-text-faint px-panel flex h-9 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap *:shrink-0">
    {keys.map(([key, label]) => (
      <span key={key}>
        <Kbd variant="plain">{key}</Kbd> {label}
      </span>
    ))}
  </div>
);

const TASK_KEYS = [
  ["n", "note"],
  ["[ ]", "previous or next task"],
  ["esc", "all tasks"],
  ["m", "message lead"],
] as const;

const FEED_KEYS = [
  ["↑↓", "move"],
  ["↵", "open the task's logbook"],
  ["m", "message lead"],
] as const;

const Notice = ({ children }: { readonly children: ReactNode }) => (
  <div
    className="text-body text-text-subtle px-panel grid flex-1 place-items-center text-center"
    data-testid="logbook-notice"
  >
    <p className="max-w-[44ch]">{children}</p>
  </div>
);

/** What shows instead of entries until there are some to show. */
const notice = (feed: LogbookFeed): ReactNode =>
  feed.kind === "ready" ? null : (
    <Notice>
      {feed.kind === "loading" ? "Reading the logbook…" : null}
      {feed.kind === "offline"
        ? "The lead's Host is offline. The logbook comes back when it reconnects."
        : null}
      {feed.kind === "unsupported"
        ? "This Host's Daemon has no logbook. Update Polaris on it to read one."
        : null}
      {feed.kind === "failed" ? `Couldn't read the logbook. ${feed.error.message}` : null}
    </Notice>
  );

/** The tab's keys, on its own element; the latest handler always runs. */
const useKeys = (handler: (event: KeyboardEvent) => void) => {
  const ref = useRef<HTMLElement>(null);
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    const el = ref.current;
    const listen = (event: KeyboardEvent) => latest.current(event);

    el?.addEventListener("keydown", listen);

    return () => el?.removeEventListener("keydown", listen);
  }, []);

  return ref;
};

const isEditable = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/**
 * Puts focus in the tab's body when it opens and whenever it switches Task or back to the
 * feed, so its keys work at once; never taken from a field the user is typing in elsewhere.
 */
export const useFocusOnShow = (ref: RefObject<HTMLElement | null>, shown: string | null) => {
  useEffect(() => {
    const el = ref.current;
    const active = document.activeElement;

    if (el === null || (isEditable(active) && !el.contains(active))) return;
    el.focus({ preventScroll: true });
  }, [ref, shown]);
};

const isTyping = (event: KeyboardEvent) =>
  (event.target instanceof Element && isEditable(event.target)) ||
  event.metaKey ||
  event.ctrlKey ||
  event.altKey;

export const LogbookTab = ({ hostKey, record }: LogbookTabProps) => {
  const c = record.constellation;
  const leadUiKey = leadKey(hostKey, c.leadSessionId);
  const ui = useLeadUi(leadUiKey);
  const facts = useFacts(record);
  const commands = useCommands();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const rail = useMemo(() => buildRail(record, facts), [record, facts]);

  const rows = useMemo(
    () => new Map<string, TaskRow>(rail.tasks.map((r) => [r.task.id, r])),
    [rail]
  );

  const row = selectedTask(ui.selected, rows);
  const taskId = row === null ? null : TaskId.make(row.task.id);
  const feed = useLogbook(hostKey, c.id, taskId);
  const log = feed.kind === "ready" ? feed.log : emptyLog;
  const entries = useMemo(() => (row === null ? feedOf(log) : []), [row, log]);

  const select = (id: string | null) =>
    patchLeadUi(leadUiKey, () => ({ selected: id === null ? null : `task:${id}` }));

  const step = (by: number) => {
    if (row === null) return;
    const at = rail.tasks.findIndex((r) => r.task.id === row.task.id);
    const next = rail.tasks[at + by];

    if (next !== undefined) select(next.task.id);
  };

  const moveCursor = (by: number) => {
    const at = entries.findIndex((e) => e.id === cursor);
    const next = entries[Math.min(entries.length - 1, Math.max(0, at + by))];

    if (next !== undefined) setCursor(next.id);
  };

  const runTask = (key: string) => {
    if (key === "Escape") select(null);
    else if (key === "n") composerRef.current?.focus();
    else if (key === "[" || key === "]") step(key === "[" ? -1 : 1);
    else return false;

    return true;
  };

  const openCursor = () => {
    const entry = entries.find((e) => e.id === cursor);

    if (entry === undefined || !rows.has(entry.taskId)) return false;
    select(entry.taskId);

    return true;
  };

  const runFeed = (key: string) => {
    if (key === "Enter") return openCursor();

    if (key !== "ArrowDown" && key !== "ArrowUp") return false;
    moveCursor(key === "ArrowDown" ? 1 : -1);

    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event)) return;

    if (event.key === "m") {
      event.preventDefault();
      patchLeadUi(leadUiKey, () => ({ focus: null }));
      commands.run("session.focusComposer");

      return;
    }

    if (row === null ? runFeed(event.key) : runTask(event.key)) event.preventDefault();
  };

  const sectionRef = useKeys(onKeyDown);

  useFocusOnShow(sectionRef, row?.task.id ?? null);

  const attempt = row?.attempt ?? null;
  const live = attempt !== null && ["working", "blocked", "review"].includes(attempt.state);

  const body =
    notice(feed) ??
    (row === null ? (
      <Feed
        entries={entries}
        tasks={rows}
        selected={cursor}
        now={facts.now}
        onSelect={setCursor}
        onOpen={(id) => (rows.has(id) ? select(id) : undefined)}
      />
    ) : (
      <TaskLog taskId={row.task.id} log={log} facts={facts} />
    ));

  return (
    <section
      aria-label={row === null ? `${c.name} logbook` : `${row.task.id}'s logbook`}
      ref={sectionRef}
      tabIndex={-1}
      className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col outline-none"
      data-testid="logbook-tab"
    >
      {row === null ? (
        <FeedHeader name={c.name} tasks={rail.tasks} />
      ) : (
        <TaskHeader
          row={row}
          constellation={c.name}
          current={log.attempts.findLast((a) => a.taskId === row.task.id) ?? null}
        />
      )}
      {body}
      {row === null ? null : (
        <div className="border-hairline border-t">
          <Composer
            key={row.task.id}
            taskId={row.task.id}
            inputRef={composerRef}
            onNote={(text) =>
              constellationCommands.note(
                hostKey,
                { constellationId: c.id, taskId: TaskId.make(row.task.id), text },
                `Couldn't note on ${row.task.id}`
              )
            }
            onMessage={
              attempt === null || !live
                ? null
                : (text) =>
                    constellationCommands.message(
                      hostKey,
                      {
                        constellationId: c.id,
                        target: MessageTarget.cases.Worker.make({ attemptId: attempt.id }),
                        text,
                        authority: "conversation",
                      },
                      `Couldn't message ${row.task.id}`
                    )
            }
          />
        </div>
      )}
      <Hints keys={row === null ? FEED_KEYS : TASK_KEYS} />
    </section>
  );
};
