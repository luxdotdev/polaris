/**
 * The tab's header (DESIGN.md, Header): the mark, the name, "led by this session · running",
 * the progress strip, Stats, and the next thing that needs you as a chip (tab jumps to it).
 */
import {
  Button,
  cn,
  Input,
  Kbd,
  PixelHandIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@polaris/ui";
import type { RefObject } from "react";
import type { AttentionItem, ConstellationRecord, Filter, Rail, Segment } from "../model/index.ts";
import { constellationStats } from "../model/stats.ts";
import { ConstellationMark } from "./glyphs.tsx";
import { ProgressStrip } from "./strip.tsx";

const StatsPopover = ({
  record,
  now,
}: {
  readonly record: ConstellationRecord;
  readonly now: number;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button size="xs" variant="ghost" data-testid="constellation-stats">
        Stats
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 p-3">
      <div className="flex flex-col gap-3">
        {constellationStats(record, now).map((group) => (
          <section key={group.title} className="flex flex-col gap-1">
            <h3 className="text-caption text-text-subtle">{group.title}</h3>
            {group.lines.map((line) => (
              <p key={line.label} className="text-body flex justify-between gap-3">
                <span className="text-text-default">{line.label}</span>
                <span className="text-text-strong tabular text-right">{line.value}</span>
              </p>
            ))}
          </section>
        ))}
        <p className="text-caption text-text-subtle">
          Tokens and cost per task are in Settings → Usage, by constellation.
        </p>
      </div>
    </PopoverContent>
  </Popover>
);

export interface HeaderProps {
  readonly record: ConstellationRecord;
  readonly segments: ReadonlyArray<Segment>;
  readonly top: AttentionItem | null;
  readonly onJump: (item: AttentionItem) => void;
  readonly now: number;
  /** "led by this session" when the Lead's own view, else "led by {title}". */
  readonly ledBy: string;
}

export const Header = ({ record, segments, top, onJump, now, ledBy }: HeaderProps) => {
  const c = record.constellation;
  const empty = c.tasks.length === 0;

  return (
    <div
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2"
      data-testid="constellation-header"
    >
      <ConstellationMark />
      <h2 className="text-heading-sm text-text-strong min-w-0 shrink truncate">{c.name}</h2>
      <span className="text-body text-text-subtle shrink-0" data-testid="constellation-state">
        {ledBy} · {c.state}
        {c.tasks.length >= 100 ? ` · ${c.tasks.length} tasks` : ""}
      </span>
      {empty ? null : <ProgressStrip segments={segments} />}
      {empty ? null : <StatsPopover record={record} now={now} />}
      {top === null ? null : (
        <button
          type="button"
          onClick={() => onJump(top)}
          className="bg-needs-you-fill text-needs-you-text text-caption rounded-control ml-auto flex h-7 max-w-full min-w-0 cursor-default items-center gap-1.5 px-2.5 font-medium"
          data-testid="constellation-attention"
        >
          <PixelHandIcon size={12} className="text-needs-you shrink-0" />
          <span className="truncate">{top.text}</span>
          <Kbd variant="plain" className="text-needs-you-text/70">
            tab
          </Kbd>
        </button>
      )}
    </div>
  );
};

const FILTERS: ReadonlyArray<readonly [Filter, string, string]> = [
  ["all", "All", "text-text-subtle"],
  ["needs-you", "Needs you", "text-needs-you-text"],
  ["review", "In review", "text-text-subtle"],
  ["working", "Working", "text-text-subtle"],
  ["done", "Done", "text-accepted-text"],
];

/** Large Constellations: filter chips with counts in their state colour, and "Filter tasks /". */
export const Filters = ({
  rail,
  filter,
  query,
  onFilter,
  onQuery,
  inputRef,
}: {
  readonly rail: Rail;
  readonly filter: Filter;
  readonly query: string;
  readonly onFilter: (f: Filter) => void;
  readonly onQuery: (q: string) => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}) => (
  <div
    className="flex shrink-0 items-center gap-1 overflow-hidden px-4 pb-2"
    role="toolbar"
    aria-label="Filter tasks"
  >
    {FILTERS.map(([value, label, tone]) => (
      <button
        key={value}
        type="button"
        aria-pressed={filter === value}
        onClick={() => onFilter(value)}
        className={cn(
          "text-label rounded-control flex h-7 shrink-0 cursor-default items-center gap-1.5 px-2 whitespace-nowrap",
          filter === value
            ? "bg-fill-selected text-text-strong"
            : "text-text-default hover:bg-fill-hover"
        )}
      >
        {label}
        <span className={cn("tabular", tone)}>{rail.counts[value]}</span>
      </button>
    ))}
    <span className="flex-1" />
    <div className="relative w-44 min-w-24 shrink">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Filter tasks"
        aria-label="Filter tasks"
        className="h-7 pr-7"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onQuery("");
            e.currentTarget.blur();
          }
        }}
      />
      <Kbd variant="plain" className="absolute top-1.5 right-2">
        /
      </Kbd>
    </div>
  </div>
);

/** The foot row: move, focus, fold, next that needs you, and the row's own key. */
export const KeyHints = ({ last }: { readonly last: string }) => (
  <div className="text-caption text-text-subtle border-hairline flex h-9 shrink-0 items-center gap-5 border-t px-4">
    <span>
      <Kbd variant="plain">↑↓</Kbd> move
    </span>
    <span>
      <Kbd variant="plain">↵</Kbd> focus
    </span>
    <span>
      <Kbd variant="plain">← →</Kbd> fold
    </span>
    <span>
      <Kbd variant="plain">tab</Kbd> next that needs you
    </span>
    <span>{last}</span>
  </div>
);
