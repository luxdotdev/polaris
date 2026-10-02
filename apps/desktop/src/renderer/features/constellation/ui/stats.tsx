/**
 * The header's Stats popover and the completion summary card, both from `constellation.stats`
 * (spec §9). Asked when shown; "not recorded" values say why.
 */
import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@polaris/ui";
import { completionFacts, type StatLine, statsCoverage, statsGroups } from "../model/stats.ts";
import type { ConstellationRecord } from "../model/index.ts";
import { type StatsState, useConstellationStats } from "../useStats.ts";
import { ConstellationMark } from "./glyphs.tsx";

const Value = ({ line }: { readonly line: StatLine }) => {
  const text = (
    <span
      className={cn("tabular text-right", line.missing ? "text-text-faint" : "text-text-strong")}
    >
      {line.value}
    </span>
  );

  return line.note === null ? (
    text
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex flex-col items-end">
          {text}
          <span className="text-caption text-text-subtle max-w-48 truncate text-right">
            {line.note}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{line.note}</TooltipContent>
    </Tooltip>
  );
};

const Line = ({ line }: { readonly line: StatLine }) => (
  <div
    className="text-body flex items-start justify-between gap-3 py-0.5"
    data-missing={line.missing ? "" : undefined}
  >
    <span className="text-text-default shrink-0">{line.label}</span>
    <span className="flex min-w-0 justify-end">
      <Value line={line} />
    </span>
  </div>
);

const Waiting = ({ state }: { readonly state: StatsState }) => {
  if (state.kind === "ready") return null;

  return (
    <p className="text-body text-text-subtle py-6 text-center">
      {state.kind === "loading"
        ? "Reading the Constellation's history…"
        : `Couldn't read stats: ${state.error.message}`}
    </p>
  );
};

const titleOf = (record: ConstellationRecord) => (taskId: string) =>
  record.constellation.tasks.find((t) => t.id === taskId)?.title ?? taskId;

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

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" data-testid="constellation-stats">
          Stats
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-80 overflow-y-auto p-3"
        data-testid="stats-popover"
      >
        {state.kind !== "ready" ? (
          <Waiting state={state} />
        ) : (
          <div className="flex flex-col gap-3">
            {statsGroups(state.view, titleOf(record)).map((group) => (
              <section key={group.title} className="flex flex-col">
                <h3 className="text-caption text-text-subtle pb-0.5">{group.title}</h3>
                {group.lines.map((line) => (
                  <Line key={line.label} line={line} />
                ))}
              </section>
            ))}
            {statsCoverage(state.view).map((note) => (
              <p key={note} className="text-caption text-text-subtle">
                {note}
              </p>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** Shown at the top of a completed Constellation's tab. */
export const CompletionCard = ({
  hostKey,
  record,
}: {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
}) => {
  const c = record.constellation;
  const state = useConstellationStats(hostKey, c.id, c.revision, true);
  const live = c.tasks.filter((t) => !t.canceled);
  const done = record.projections.filter((p) => p.state === "done").length;

  return (
    <div
      className="rounded-row border-hairline bg-surface-raised mx-4 mb-2 border px-3.5 py-3"
      data-testid="completion-card"
    >
      <p className="flex items-center gap-2 pb-2">
        <ConstellationMark size={14} />
        <span className="text-label text-text-strong">Constellation {c.state}</span>
        {state.kind === "ready" ? (
          <span className="text-body text-text-subtle min-w-0 truncate">
            · {completionFacts(state.view, done, live.length).headline}
          </span>
        ) : null}
      </p>
      {state.kind !== "ready" ? (
        <Waiting state={state} />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 @[36rem]:grid-cols-2">
          {completionFacts(state.view, done, live.length).lines.map((line) => (
            <Line key={line.label} line={line} />
          ))}
        </div>
      )}
    </div>
  );
};
