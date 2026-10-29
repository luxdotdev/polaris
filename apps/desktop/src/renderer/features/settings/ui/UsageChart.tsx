/**
 * Settings → Usage's daily chart: stacked bars in Harness hues, and on hover or keyboard
 * focus (← → Home End) a tooltip listing the day's Models with tokens and cost, then its total.
 * A click, ↵ or Space pins the day for the by-model table; esc or another click unpins. The tooltip is a popover in its own layer, so the card never clips it and it stays in the window.
 */
import {
  cn,
  harnessHue,
  hueVar,
  Kicker,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@polaris/ui";
import { type KeyboardEvent, memo, type PointerEvent, useId, useState } from "react";
import { type Day, type DayTipRow, dayTip, shortDate, type UsageSummary } from "../model/usage.ts";

/** Usage outside Polaris at ~32% of the Harness hue (DESIGN.md, Settings). */
const outsideFill = (harness: string) => `color-mix(in oklab, ${hueVar(harness)} 32%, transparent)`;

const Bar = memo(
  ({
    day,
    max,
    split,
    active,
    pinned,
  }: {
    readonly day: Day;
    readonly max: number;
    readonly split: boolean;
    readonly active: boolean;
    readonly pinned: boolean;
  }) => (
    <div
      className={cn(
        "relative flex h-full min-w-0 flex-1 flex-col-reverse",
        pinned ? "bg-fill-selected" : active && "bg-fill-hover"
      )}
      data-testid="usage-bar"
      data-date={day.date}
      data-active={active || undefined}
      data-pinned={pinned || undefined}
    >
      {/* Selection is a grey fill, never Starlight (rule/starlight-is-rare); the cap marks it. */}
      {pinned ? <span className="bg-text-strong absolute inset-x-0 top-0 h-0.5" /> : null}
      {day.series.flatMap((s) => {
        const parts = split
          ? [
              { key: "in", n: s.polaris, fill: hueVar(s.harness) },
              { key: "out", n: s.outside, fill: outsideFill(s.harness) },
            ]
          : [{ key: "all", n: s.polaris + s.outside, fill: hueVar(s.harness) }];

        return parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <span
              key={`${s.harness}-${p.key}`}
              className="shrink-0"
              style={{ height: `${(p.n / max) * 100}%`, background: p.fill }}
            />
          ));
      })}
    </div>
  )
);

const Legend = ({
  harnesses,
  split,
}: {
  readonly harnesses: ReadonlyArray<string>;
  readonly split: boolean;
}) => (
  <>
    {harnesses.map((h) => (
      <span
        key={h}
        className="text-caption text-text-subtle flex items-center gap-1.5 whitespace-nowrap"
      >
        <span className="size-2 shrink-0" style={{ background: hueVar(h) }} />
        {harnessHue(h).name}
      </span>
    ))}
    {split ? (
      <span className="text-caption text-text-subtle flex items-center gap-1.5 whitespace-nowrap">
        <span className="bg-text-subtle size-2 shrink-0 opacity-35" />
        Outside Polaris
      </span>
    ) : null}
  </>
);

const TipLine = ({
  label,
  tokens,
  cost,
}: {
  readonly label: string;
  readonly tokens: string;
  readonly cost: string;
}) => (
  <span className="border-hairline flex items-center gap-1.5 border-t pt-1">
    <span className="text-text-subtle flex-1">{label}</span>
    <span className="text-text-default tabular shrink-0">{tokens}</span>
    <span className="text-text-subtle tabular w-[68px] shrink-0 text-right">{cost}</span>
  </span>
);

const TipRow = ({ row }: { readonly row: DayTipRow }) => (
  <span className="flex items-center gap-1.5" data-outside={row.outside || undefined}>
    <span
      className="size-2 shrink-0"
      style={{ background: row.outside ? outsideFill(row.harness) : hueVar(row.harness) }}
    />
    <span
      className={cn(
        "min-w-0 flex-1 truncate",
        row.outside ? "text-text-subtle" : "text-text-default"
      )}
    >
      {row.model}
    </span>
    <span
      className={cn("tabular shrink-0", row.outside ? "text-text-subtle" : "text-text-default")}
    >
      {row.tokens}
    </span>
    <span className="text-text-subtle tabular w-[68px] shrink-0 text-right">{row.cost}</span>
  </span>
);

/**
 * One day's Models, tokens and cost; estimates carry "~", reported costs don't. Split, the
 * Polaris rows and their subtotal lead and usage outside Polaris follows, dimmed.
 */
const DayTooltip = ({
  id,
  day,
  today,
  split,
}: {
  readonly id: string;
  readonly day: Day;
  readonly today: boolean;
  readonly split: boolean;
}) => {
  const tip = dayTip(day, split);
  const inside = tip.rows.filter((r) => !r.outside);
  const outside = tip.rows.filter((r) => r.outside);

  return (
    <PopoverContent
      id={id}
      role="tooltip"
      data-testid="usage-tooltip"
      side="top"
      sideOffset={8}
      // The chart keeps focus, so ← → and esc still reach it; esc is the chart's to handle.
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => event.preventDefault()}
      className="rounded-control bg-surface-raised text-caption pointer-events-none flex w-[260px] flex-col gap-1 px-2.5 py-2"
    >
      <span className="text-text-default font-medium">{today ? "Today" : shortDate(tip.date)}</span>
      {tip.rows.length === 0 ? (
        <span className="text-text-subtle">No tokens</span>
      ) : (
        <>
          {inside.map((row) => (
            <TipRow key={row.key} row={row} />
          ))}
          {tip.polaris === null ? null : <TipLine label="In Polaris sessions" {...tip.polaris} />}
          {outside.map((row) => (
            <TipRow key={row.key} row={row} />
          ))}
          <TipLine label="Total" tokens={tip.tokens} cost={tip.cost} />
        </>
      )}
    </PopoverContent>
  );
};

const KEY_STEPS = new Map([
  ["ArrowLeft", (i: number) => Math.max(0, i - 1)],
  ["ArrowRight", (i: number, last: number) => Math.min(last, i + 1)],
  ["Home", () => 0],
  ["End", (_: number, last: number) => last],
]);

/** The day a click landed on: its bar, or in the gap between two the day under the pointer. */
const clickedDate = (target: EventTarget, hovered: Day | undefined) =>
  (target instanceof Element ? target.closest<HTMLElement>("[data-date]")?.dataset.date : null) ??
  hovered?.date;

export const UsageChart = ({
  summary,
  split,
  pinned = null,
  onPin = () => undefined,
}: {
  readonly summary: UsageSummary;
  readonly split: boolean;
  /** The pinned day's `YYYY-MM-DD`, or null for the whole range. */
  readonly pinned?: string | null;
  readonly onPin?: (date: string | null) => void;
}) => {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const days = summary.days;
  const last = days.length - 1;
  const max = Math.max(1, ...days.map((d) => d.total));
  const first = days[0];
  const shown = active === null ? undefined : days[active];

  // Only a new day re-renders: React skips setting the same index.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.floor(((event.clientX - box.left) / box.width) * days.length);

    setActive(Math.min(last, Math.max(0, i)));
  };

  const toggle = (date: string | undefined) => {
    if (date !== undefined) onPin(date === pinned ? null : date);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Unpin first; the next esc hides the tooltip, the one after leaves Settings.
      event.stopPropagation();

      return pinned === null ? setActive(null) : onPin(null);
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();

      return toggle(days[active ?? last]?.date);
    }

    const step = KEY_STEPS.get(event.key);

    if (step === undefined) return;
    event.preventDefault();
    setActive(step(active ?? last, last));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div
          className="border-hairline flex h-[120px] items-end gap-[3px] border-t pt-2"
          role="group"
          aria-label={
            pinned === null ? "Tokens per day" : `Tokens per day, ${shortDate(pinned)} pinned`
          }
          aria-describedby={shown === undefined ? undefined : tipId}
          tabIndex={0}
          data-testid="usage-chart"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((i) => i ?? last)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
          onClick={(event) => toggle(clickedDate(event.target, shown))}
        >
          {days.map((day, i) => (
            <Bar
              key={day.date}
              day={day}
              max={max}
              split={split}
              active={i === active}
              pinned={day.date === pinned}
            />
          ))}
        </div>
        <Popover open={shown !== undefined}>
          {shown === undefined || active === null ? null : (
            <>
              {/* A new anchor per day: the popover re-places itself on the day it points at. */}
              <PopoverAnchor
                key={active}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px"
                style={{ left: `${((active + 0.5) / days.length) * 100}%` }}
              />
              <DayTooltip id={tipId} day={shown} today={active === last} split={split} />
            </>
          )}
        </Popover>
      </div>
      <div className="gap-panel flex items-center">
        <span className="shrink-0 whitespace-nowrap">
          <Kicker>{first === undefined ? "" : shortDate(first.date)}</Kicker>
        </span>
        {/* Many Harnesses wrap between entries, never inside one. */}
        <div className="gap-x-panel flex min-w-0 flex-1 flex-wrap justify-center gap-y-1">
          <Legend harnesses={summary.harnesses} split={split} />
        </div>
        <span className="shrink-0 whitespace-nowrap">
          <Kicker>Today</Kicker>
        </span>
      </div>
    </div>
  );
};
