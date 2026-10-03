/**
 * A Lead in the sidebar (DESIGN.md, Constellation (DAG) → Sidebar; Paper C1): its session row
 * with the Constellation mark and "Lead · 7 workers", then its workers on a hairline rail under
 * their Task groups, needs-you first, accepted ones folded into one "A1, A2 done · show" line.
 */
import { ChevronDownIcon, ChevronRightIcon, cn, Row } from "@polaris/ui";
import { type KeyboardEvent, useState } from "react";
import { needsYou, shownState } from "../../../routes/topBar.ts";
import { age } from "../../../shell/copy.ts";
import { SessionTile } from "../../../shell/glyphs.tsx";
import { useApp, useNav, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { buttonProps, WithHover } from "../../../shell/sidebar/SessionRow.tsx";
import { LANE_MAX, laneWidth } from "../../constellation/model/lane.ts";
import { IdLane, laneStyle } from "../../constellation/ui/lane.tsx";
import { ConstellationMark, TaskGlyph } from "../glyphs.tsx";
import {
  doneLine,
  idsOnly,
  type LeadGroup as Group,
  type LeadWorker,
  leadLine,
  type WorkerRow,
  type WorkerSection,
  workerSections,
} from "../model/leadGroups.ts";
import { setupHover, shownWorker, TONE_CLASS } from "../model/workerCopy.ts";
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

/**
 * The row's id and title; when its Lead's ids are slugs the id alone fills the row, the
 * title in its tooltip and accessible name.
 */
const WorkerTitle = ({
  row,
  tone,
  idOnly,
}: {
  readonly row: LeadWorker;
  readonly tone: string;
  readonly idOnly: boolean;
}) =>
  idOnly ? (
    <span className="flex min-w-0" title={`${row.taskId} · ${row.title}`}>
      <span className={cn("text-code-inline truncate font-mono", tone)}>{row.taskId}</span>
      <span className="sr-only"> · {row.title}</span>
    </span>
  ) : (
    <span className="flex min-w-0 items-baseline gap-2">
      <IdLane id={row.taskId} max={LANE_MAX.sidebar} className={tone} />
      <span className="truncate">{row.title}</span>
    </span>
  );

const Worker = ({
  hostKey,
  group,
  row,
  idOnly,
  now,
}: {
  readonly hostKey: string;
  readonly group: Group;
  readonly row: LeadWorker;
  readonly idOnly: boolean;
  readonly now: number;
}) => {
  const { selectSession } = useShellActions();
  const { focusTask } = useConstellationActions();
  const selection = useSelection();
  const leadId = group.lead.session.id;
  const focused = useFocusedTask(hostKey, leadId);
  const shown = shownWorker(row);
  const hostLabel = useApp((s) => s.hosts.find((h) => h.key === row.hostKey)?.label ?? "its host");

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
        <WorkerTitle
          row={row}
          idOnly={idOnly}
          tone={shown.tone === "needs-you" ? "text-needs-you-text" : "text-text-subtle"}
        />
      }
      meta={<WorkerMeta row={row} shown={shown} hostLabel={hostLabel} now={now} />}
    />
  );
};

/** The row's state or age: "setting up · 1m", "setup failed", "waiting · 2m", "31m". */
const WorkerMeta = ({
  row,
  shown,
  hostLabel,
  now,
}: {
  readonly row: LeadWorker;
  readonly shown: ReturnType<typeof shownWorker>;
  readonly hostLabel: string;
  readonly now: number;
}) => {
  const tone = TONE_CLASS[shown.tone];

  if (row.kind === "setup") {
    const since = age(row.setup.run.startedAt, now);
    const failed = row.state === "setup-failed";

    // The command would push the id and title out of a sidebar row; it shows on hover.
    return (
      <span className={tone} title={setupHover(row.setup.run, failed, since)}>
        {failed ? shown.word : `${shown.word} · ${since}`}
      </span>
    );
  }

  return <AttemptMeta row={row} tone={tone} word={shown.word} hostLabel={hostLabel} now={now} />;
};

const AttemptMeta = ({
  row,
  tone,
  word,
  hostLabel,
  now,
}: {
  readonly row: WorkerRow;
  readonly tone: string;
  readonly word: string | null;
  readonly hostLabel: string;
  readonly now: number;
}) =>
  row.slotSince === null ? (
    <span className={tone}>{word ?? age(row.attempt.startedAt, now)}</span>
  ) : (
    <span
      className={tone}
      title={`Waiting for a slot on ${hostLabel} · ${age(row.slotSince, now)}`}
    >
      waiting · {age(row.slotSince, now)}
    </span>
  );

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

/** A Task group's heading, its label on the id lane and what needs you on the meta lane. */
const SectionHeading = ({ section }: { readonly section: WorkerSection }) => (
  <div
    data-testid="worker-section"
    className="h-tree-row gap-gap px-row-x text-caption text-text-faint flex items-center"
  >
    <span aria-hidden className="w-4 shrink-0" />
    <span className="min-w-0 flex-1 truncate">{section.label}</span>
    {section.needsYou === 0 ? null : (
      <span className="text-needs-you-text tabular shrink-0">{section.needsYou} needs you</span>
    )}
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

  const sections = workerSections(showDone ? [...group.workers, ...group.done] : group.workers);
  const ids = [...group.workers, ...group.done].map((r) => r.taskId);
  const idOnly = idsOnly(group);

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
          style={laneStyle(laneWidth(ids, LANE_MAX.sidebar))}
        >
          {sections.map((section) => (
            <div
              key={section.key}
              className="flex flex-col"
              role="group"
              aria-label={section.label ?? undefined}
            >
              {section.label === null ? null : <SectionHeading section={section} />}
              {section.rows.map((row) => (
                <Worker
                  key={row.taskId}
                  hostKey={hostKey}
                  group={group}
                  row={row}
                  idOnly={idOnly}
                  now={now}
                />
              ))}
            </div>
          ))}
          {group.done.length > 0 && !showDone ? (
            <DoneLine group={group} onShow={() => setShowDone(true)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
