/**
 * A Lead in the sidebar (DESIGN.md, Constellation (DAG) → Sidebar; Paper C1): its session row
 * with the Constellation mark and "Lead · 7 workers", then its workers on a hairline rail,
 * needs-you first, accepted ones folded into one "A1, A2 done · show" line.
 */
import { ChevronDownIcon, ChevronRightIcon, cn, Row } from "@polaris/ui";
import { type KeyboardEvent, useState } from "react";
import { needsYou, shownState } from "../../../routes/topBar.ts";
import { age } from "../../../shell/copy.ts";
import { SessionTile } from "../../../shell/glyphs.tsx";
import { useApp, useNav, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { buttonProps, WithHover } from "../../../shell/sidebar/SessionRow.tsx";
import { ConstellationMark, TaskGlyph } from "../glyphs.tsx";
import {
  doneLine,
  type LeadGroup as Group,
  leadLine,
  type WorkerRow,
} from "../model/leadGroups.ts";
import { shownWorker, TONE_CLASS } from "../model/workerCopy.ts";
import { useConstellationActions, useFocusedTask } from "../source.ts";

interface GroupProps {
  readonly hostKey: string;
  readonly group: Group;
  readonly now: number;
}

const LeadLine = ({ group, open }: { readonly group: Group; readonly open: boolean }) => {
  const line = leadLine(group);

  return (
    <span className="flex min-w-0 items-center gap-1">
      <ConstellationMark size={12} />
      {open ? (
        <span className="truncate">Lead · {line.workers}</span>
      ) : (
        <span className="truncate">
          ▸ {line.workers}
          {line.needsYou === null ? null : (
            <span className="text-needs-you-text"> · {line.needsYou}</span>
          )}
        </span>
      )}
    </span>
  );
};

const Worker = ({
  hostKey,
  group,
  row,
  now,
}: {
  readonly hostKey: string;
  readonly group: Group;
  readonly row: WorkerRow;
  readonly now: number;
}) => {
  const { selectSession } = useShellActions();
  const { focusTask } = useConstellationActions();
  const selection = useSelection();
  const leadId = group.lead.session.id;
  const focused = useFocusedTask(hostKey, leadId);
  const shown = shownWorker(row);

  const selected =
    selection.pane === "session" &&
    ((selection.sessionId === leadId && focused === row.taskId) ||
      selection.sessionId === row.sessionId);

  const select = () => {
    selectSession({ hostKey, sessionId: leadId });
    focusTask({ hostKey, leadSessionId: leadId, taskId: row.taskId });
  };

  return (
    <Row
      {...buttonProps(select)}
      data-testid="worker-row"
      data-task={row.taskId}
      data-worker-state={row.state}
      aria-current={selected}
      selected={selected}
      className={cn(selected && "border-hairline bg-row-selected hover:bg-row-selected")}
      leading={
        <TaskGlyph glyph={shown.glyph} harness={row.entry?.session.harness ?? null} size={16} />
      }
      title={
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "text-code-inline w-6 shrink-0 font-mono",
              shown.tone === "needs-you" ? "text-needs-you-text" : "text-text-subtle"
            )}
          >
            {row.taskId}
          </span>
          <span className="truncate">{row.title}</span>
        </span>
      }
      meta={
        <span className={TONE_CLASS[shown.tone]}>
          {shown.word ?? age(row.attempt.startedAt, now)}
        </span>
      }
    />
  );
};

const DoneLine = ({ group, onShow }: { readonly group: Group; readonly onShow: () => void }) => (
  <div className="h-tree-row gap-gap px-row-x text-caption text-text-subtle flex items-center">
    <TaskGlyph glyph="accepted" harness={null} size={16} />
    <span className="truncate">{doneLine(group.done)} ·</span>
    <button
      type="button"
      onClick={onShow}
      className="hover:text-text-default shrink-0 cursor-default underline-offset-2 hover:underline"
    >
      show
    </button>
  </div>
);

const useOpen = (hostKey: string, group: Group) => {
  const selection = useSelection();
  const folded = useNav((s) => s.folded[group.key]);

  const inGroup =
    selection.hostKey === hostKey &&
    (selection.sessionId === group.lead.session.id ||
      group.workers.some((w) => w.sessionId === selection.sessionId));

  return folded === undefined ? inGroup : !folded;
};

export const LeadGroup = ({ hostKey, group, now }: GroupProps) => {
  const { selectSession, toggleFolded } = useShellActions();
  const { unfocusTask } = useConstellationActions();
  const density = useApp((s) => s.density);
  const selection = useSelection();
  const open = useOpen(hostKey, group);
  const [showDone, setShowDone] = useState(false);
  const { lead } = group;
  const leadId = lead.session.id;
  const focused = useFocusedTask(hostKey, leadId);

  const select = () => {
    selectSession({ hostKey, sessionId: leadId });
    unfocusTask({ hostKey, leadSessionId: leadId });
  };

  const selected =
    selection.pane === "session" && selection.sessionId === leadId && focused === null;

  const props = buttonProps(select);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      toggleFolded(group.key, event.key === "ArrowRight");

      return;
    }

    props.onKeyDown(event);
  };

  const workers = showDone ? [...group.workers, ...group.done] : group.workers;

  return (
    <div className="flex flex-col" data-testid="lead-group" data-lead={leadId}>
      <WithHover hostKey={hostKey} entry={lead}>
        <Row
          {...props}
          onKeyDown={onKeyDown}
          aria-current={selected}
          aria-expanded={open}
          data-state={shownState(lead)}
          variant="session"
          selected={selected}
          tone={needsYou(lead) ? "needs-you" : "default"}
          leading={
            <SessionTile
              state={shownState(lead)}
              harness={lead.session.harness}
              density={density}
            />
          }
          title={lead.session.title || group.view.constellation.name}
          description={<LeadLine group={group} open={open} />}
          meta={age(lead.session.createdAt, now)}
          trailing={
            <button
              type="button"
              aria-label={open ? "Fold workers" : "Show workers"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFolded(group.key, !open);
              }}
              className="text-text-faint hover:text-text-default -mr-1 hidden size-4 cursor-default items-center justify-center group-hover/row:flex"
            >
              {open ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
            </button>
          }
        />
      </WithHover>
      {open ? (
        <div
          data-testid="lead-workers"
          className="border-hairline ml-[calc(var(--spacing-gap)+var(--density-harness-tile)/2)] flex flex-col border-l pl-1"
        >
          {workers.map((row) => (
            <Worker key={row.taskId} hostKey={hostKey} group={group} row={row} now={now} />
          ))}
          {group.done.length > 0 && !showDone ? (
            <DoneLine group={group} onShow={() => setShowDone(true)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
