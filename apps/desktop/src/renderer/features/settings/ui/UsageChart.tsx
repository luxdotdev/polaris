/**
 * Settings → Usage's daily chart: stacked bars in Harness hues, and on hover or keyboard
 * focus (← → Home End) a tooltip listing the day's Models with tokens and cost, then its total.
 */
import { cn, harnessHue, hueVar } from "@polaris/ui";
import { type KeyboardEvent, memo, type PointerEvent, useId, useState } from "react";
import { type Day, dayTip, type UsageSummary } from "../model/usage.ts";

/** Usage outside Polaris at ~32% of the Harness hue (DESIGN.md, Settings). */
const outsideFill = (harness: string) => `color-mix(in oklab, ${hueVar(harness)} 32%, transparent)`;

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const Bar = memo(
  ({
    day,
    max,
    split,
    active,
  }: {
    readonly day: Day;
    readonly max: number;
    readonly split: boolean;
    readonly active: boolean;
  }) => (
    <div
      className={cn("flex h-full min-w-0 flex-1 flex-col-reverse", active && "bg-fill-hover")}
      data-testid="usage-bar"
      data-active={active || undefined}
    >
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
      <span key={h} className="text-caption text-text-subtle flex items-center gap-1.5">
        <span className="size-2 shrink-0" style={{ background: hueVar(h) }} />
        {harnessHue(h).name}
      </span>
    ))}
    {split ? (
      <span className="text-caption text-text-subtle flex items-center gap-1.5">
        <span className="bg-text-subtle size-2 shrink-0 opacity-35" />
        Outside Polaris
      </span>
    ) : null}
  </>
);

/** One day's Models, tokens and cost; estimates carry "~", reported costs don't. */
const DayTooltip = ({
  id,
  day,
  today,
  at,
}: {
  readonly id: string;
  readonly day: Day;
  readonly today: boolean;
  /** 0–1 across the chart: the tooltip slides with it so it never leaves the chart. */
  readonly at: number;
}) => {
  const tip = dayTip(day);

  return (
    <div
      id={id}
      role="tooltip"
      data-testid="usage-tooltip"
      className="rounded-control border-hairline bg-surface-raised shadow-float text-caption pointer-events-none absolute bottom-full z-10 mb-2 flex w-[260px] flex-col gap-1 border px-2.5 py-2"
      style={{ left: `${at * 100}%`, transform: `translateX(-${at * 100}%)` }}
    >
      <span className="text-text-default font-medium">{today ? "Today" : shortDate(tip.date)}</span>
      {tip.rows.length === 0 ? (
        <span className="text-text-subtle">No tokens</span>
      ) : (
        <>
          {tip.rows.map((row) => (
            <span key={row.key} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0" style={{ background: hueVar(row.harness) }} />
              <span className="text-text-default min-w-0 flex-1 truncate">{row.model}</span>
              <span className="text-text-default tabular shrink-0">{row.tokens}</span>
              <span className="text-text-subtle tabular w-[68px] shrink-0 text-right">
                {row.cost}
              </span>
            </span>
          ))}
          <span className="border-hairline flex items-center gap-1.5 border-t pt-1">
            <span className="text-text-subtle flex-1">Total</span>
            <span className="text-text-default tabular shrink-0">{tip.tokens}</span>
            <span className="text-text-subtle tabular w-[68px] shrink-0 text-right">
              {tip.cost}
            </span>
          </span>
        </>
      )}
    </div>
  );
};

const KEY_STEPS = new Map([
  ["ArrowLeft", (i: number) => Math.max(0, i - 1)],
  ["ArrowRight", (i: number, last: number) => Math.min(last, i + 1)],
  ["Home", () => 0],
  ["End", (_: number, last: number) => last],
]);

export const UsageChart = ({
  summary,
  split,
}: {
  readonly summary: UsageSummary;
  readonly split: boolean;
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") return setActive(null);
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
          aria-label="Tokens per day"
          aria-describedby={shown === undefined ? undefined : tipId}
          tabIndex={0}
          data-testid="usage-chart"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((i) => i ?? last)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          {days.map((day, i) => (
            <Bar key={day.date} day={day} max={max} split={split} active={i === active} />
          ))}
        </div>
        {shown === undefined || active === null ? null : (
          <DayTooltip
            id={tipId}
            day={shown}
            today={active === last}
            at={(active + 0.5) / days.length}
          />
        )}
      </div>
      <div className="gap-panel flex items-center">
        <span className="text-caption text-text-subtle">
          {first === undefined ? "" : shortDate(first.date)}
        </span>
        <span className="flex-1" />
        <Legend harnesses={summary.harnesses} split={split} />
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">Today</span>
      </div>
    </div>
  );
};
