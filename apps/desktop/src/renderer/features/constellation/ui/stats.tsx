/**
 * The header's Stats popover (charts, ENG-470) and the completion summary card, both from
 * `constellation.stats` (spec §9). Asked when shown; "not recorded" values say why.
 */
import {
  Button,
  InstrumentCard,
  InstrumentPopoverContent,
  Popover,
  PopoverTrigger,
  SegmentedControl,
} from "@polaris/ui";
import { completionHeadline, completionTally, statsCoverage } from "../model/stats.ts";
import { type Measure, statsPanel } from "../model/statsPanel.ts";
import { clock } from "../model/copy.ts";
import type { ConstellationStatsView } from "../../../../shared/api.ts";
import type { ConstellationRecord } from "../model/index.ts";
import { type StatsState, useConstellationStats } from "../useStats.ts";
import { ConstellationMark } from "./glyphs.tsx";
import {
  Lead,
  leadHarness,
  Review,
  SpendHeadline,
  SpendWell,
  Well,
  Workers,
  WorkWell,
} from "./statsCharts.tsx";
import { useState } from "react";

const Waiting = ({ state }: { readonly state: StatsState }) => {
  if (state.kind === "ready") return null;

  return (
    <p className="text-body text-text-subtle py-6 text-center">
      {state.kind === "loading"
        ? "Reading the constellation's history…"
        : `Couldn't read stats: ${state.error.message}`}
    </p>
  );
};

const titleOf = (record: ConstellationRecord) => (taskId: string) =>
  record.constellation.tasks.find((t) => t.id === taskId)?.title ?? taskId;

const MEASURES = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
] as const;

/** The footer's status line: when the stats were read, and at which revision. */
const asOf = (view: ConstellationStatsView) => [
  `As of ${clock(view.stats.asOf)}`,
  `revision ${view.stats.revision}`,
];

const Notes = ({ view }: { readonly view: ConstellationStatsView }) => {
  const notes = statsCoverage(view);

  return notes.length === 0 ? null : (
    <div className="border-hairline flex flex-col gap-1 border-t border-dashed px-3.5 py-2.5">
      {notes.map((note) => (
        <p key={note} className="text-caption text-text-subtle">
          {note}
        </p>
      ))}
    </div>
  );
};

export const StatsPopover = ({
  hostKey,
  record,
  open,
  onOpenChange,
}: {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => {
  const c = record.constellation;
  const state = useConstellationStats(hostKey, c.id, c.revision, open);
  const [asked, setAsked] = useState<Measure>("cost");
  const panel = state.kind === "ready" ? statsPanel(state.view, titleOf(record), asked) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" data-testid="constellation-stats">
          Stats
        </Button>
      </PopoverTrigger>
      <InstrumentPopoverContent
        align="end"
        data-testid="stats-popover"
        header={{
          mark: <ConstellationMark size={14} />,
          title: c.name,
          control:
            panel === null ? undefined : (
              <SegmentedControl
                variant="well"
                aria-label="Measure spend in"
                value={panel.measure}
                onValueChange={setAsked}
                options={MEASURES.map((m) => ({
                  ...m,
                  disabled: m.value === "cost" && !panel.priced,
                }))}
              />
            ),
        }}
        wells={
          state.kind !== "ready" || panel === null
            ? [<Waiting key="waiting" state={state} />]
            : [
                <SpendWell key="spend" panel={panel} />,
                <WorkWell key="work" panel={panel}>
                  <Notes view={state.view} />
                </WorkWell>,
              ]
        }
        footer={state.kind === "ready" ? { status: asOf(state.view).join(" · ") } : undefined}
      />
    </Popover>
  );
};

/**
 * Shown at the top of a completed Constellation's rail, scrolling with its tasks: the popover's
 * instrument at rest, cost as its hero, the wells side by side when the tab is wide.
 */
export const CompletionCard = ({
  hostKey,
  record,
}: {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
}) => {
  const c = record.constellation;
  const state = useConstellationStats(hostKey, c.id, c.revision, true);
  const panel = state.kind === "ready" ? statsPanel(state.view, titleOf(record)) : null;

  return (
    <InstrumentCard
      aria-label={`Constellation ${c.state}`}
      data-testid="completion-card"
      className="mx-3 w-auto shrink-0"
      columns
      header={{
        mark: <ConstellationMark size={14} />,
        title: `Constellation ${c.state}`,
        state: completionHeadline(completionTally(c.tasks, record.projections)),
      }}
      wells={
        state.kind !== "ready" || panel === null
          ? [<Waiting key="waiting" state={state} />]
          : [
              <Well key="spend" testId="completion-spend">
                <SpendHeadline panel={panel} />
                <Review review={panel.review} />
              </Well>,
              <Well key="work" testId="completion-work">
                <Workers workers={panel.workers} />
                <Lead lead={panel.lead} harness={leadHarness(panel)} />
                <Notes view={state.view} />
              </Well>,
            ]
      }
      footer={state.kind === "ready" ? { status: asOf(state.view).join(" · ") } : undefined}
    />
  );
};
