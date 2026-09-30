/**
 * Settings → Usage (DESIGN.md, Settings; Paper S2): Plan Limits first, then
 * tokens over 7 / 30 / 90 days, the three figures, a stacked daily chart in
 * Harness hues, and a by-model table where estimated costs carry a "~".
 */
import { hueVar, SegmentedControl, Switch, Tile, Dither, harnessHue } from "@polaris/ui";
import { useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import { type LimitRow, type LimitWindow, limitRows, METER_CELLS } from "../model/planLimits.ts";
import { sectionInfo } from "../model/sections.ts";
import {
  compactTokens,
  costLabel,
  type Day,
  RANGES,
  type RangeDays,
  type UsageSummary,
  usageSummary,
} from "../model/usage.ts";
import { Column, Group, Heading, PageHeader } from "./parts.tsx";
import { useUsage } from "./useUsage.ts";

/** A 40-cell pixel meter (4×10px cells): lit in the Harness hue, unlit at 7%. */
const Meter = ({ harness, lit }: { readonly harness: string; readonly lit: number }) => (
  <span aria-hidden className="flex h-2.5 gap-px">
    {Array.from({ length: METER_CELLS }, (_, i) => (
      <span
        key={i}
        className="h-2.5 w-1 shrink-0"
        style={{
          background: i < lit ? hueVar(harness) : "light-dark(#0000000f, #ffffff12)",
        }}
      />
    ))}
  </span>
);

const WindowCell = ({ harness, win }: { readonly harness: string; readonly win: LimitWindow }) => (
  <div className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid="plan-window">
    <div className="flex justify-between gap-2" style={{ maxWidth: 199 }}>
      <span className="text-caption text-text-subtle truncate">{win.label}</span>
      <span className="text-caption text-text-default tabular">{win.percent ?? ""}</span>
    </div>
    <Meter harness={harness} lit={win.litCells} />
    <span className="text-caption text-text-subtle">{win.note}</span>
  </div>
);

const HarnessTile = ({ harness, size }: { readonly harness: string; readonly size: 28 | 40 }) => (
  <Tile hue={harness} size={size}>
    <Dither hue={harness} size={size === 40 ? 20 : 12} />
  </Tile>
);

const LimitRowView = ({ row }: { readonly row: LimitRow }) => (
  <div className="px-panel gap-section flex items-center py-3.5">
    <div className="flex w-[152px] shrink-0 items-center gap-2.5">
      <HarnessTile harness={row.harness} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className="text-body text-text-default truncate font-medium">{row.name}</span>
        <span className="text-caption text-text-subtle truncate">{row.caption}</span>
      </span>
    </div>
    {row.windows.map((win) => (
      <WindowCell key={win.key} harness={row.harness} win={win} />
    ))}
  </div>
);

const PlanLimits = ({ rows }: { readonly rows: ReadonlyArray<LimitRow> }) => (
  <div className="flex flex-col gap-2.5">
    <Heading>Plan limits</Heading>
    {rows.length === 0 ? (
      <p className="text-caption text-text-subtle">
        No plan limits reported yet. A harness reports its limits as it runs.
      </p>
    ) : (
      <Group label="Plan limits">
        {rows.map((row) => (
          <LimitRowView key={row.harness} row={row} />
        ))}
      </Group>
    )}
  </div>
);

const Figure = ({ value, caption }: { readonly value: string; readonly caption: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-display text-text-strong tabular font-medium">{value}</span>
    <span className="text-caption text-text-subtle">{caption}</span>
  </div>
);

/** Usage outside Polaris at ~32% of the Harness hue (DESIGN.md, Settings). */
const outsideFill = (harness: string) => `color-mix(in oklab, ${hueVar(harness)} 32%, transparent)`;

const Bar = ({
  day,
  max,
  split,
}: {
  readonly day: Day;
  readonly max: number;
  readonly split: boolean;
}) => (
  <div
    className="flex h-full min-w-0 flex-1 flex-col-reverse"
    title={`${day.date}: ${compactTokens(day.total)}`}
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
);

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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

const Chart = ({ summary, split }: { readonly summary: UsageSummary; readonly split: boolean }) => {
  const max = Math.max(1, ...summary.days.map((d) => d.total));
  const first = summary.days[0];

  return (
    <div className="flex flex-col gap-2">
      <div
        className="border-hairline flex h-[120px] items-end gap-[3px] border-t pt-2"
        aria-label="Tokens per day"
        role="img"
      >
        {summary.days.map((day) => (
          <Bar key={day.date} day={day} max={max} split={split} />
        ))}
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

const ModelTable = ({ summary }: { readonly summary: UsageSummary }) => (
  <Group label="By model">
    <div className="bg-surface-sunken h-row px-panel text-caption text-text-subtle flex shrink-0 items-center">
      <span className="flex-1">Model</span>
      <span className="w-[120px] shrink-0">Harness</span>
      <span className="w-[90px] shrink-0 text-right">Tokens</span>
      <span className="w-[110px] shrink-0 text-right">Cost</span>
    </div>
    {summary.byModel.map((row) => (
      <div key={`${row.harness}/${row.model}`} className="px-panel flex h-9 shrink-0 items-center">
        <span className="text-body text-text-default flex-1 truncate font-medium">{row.model}</span>
        <span className="text-caption text-text-subtle flex w-[120px] shrink-0 items-center gap-1.5">
          <span className="size-2 shrink-0" style={{ background: hueVar(row.harness) }} />
          {harnessHue(row.harness).name}
        </span>
        <span className="text-body text-text-default tabular w-[90px] shrink-0 text-right">
          {compactTokens(row.tokens)}
        </span>
        <span className="text-body text-text-subtle tabular w-[110px] shrink-0 text-right">
          {costLabel(row.cost)}
        </span>
      </div>
    ))}
  </Group>
);

const costCaption = (summary: UsageSummary) => {
  if (summary.cost.estimated) return "API-equivalent · estimated";

  return summary.cost.partial
    ? "Reported by harnesses · estimates not yet available"
    : "Reported by harnesses";
};

const RANGE_OPTIONS = RANGES.map((d) => ({ value: String(d), label: `${d} days` }));

const Tokens = ({
  summary,
  hostCount,
  days,
  onDays,
}: {
  readonly summary: UsageSummary;
  readonly hostCount: number;
  readonly days: RangeDays;
  readonly onDays: (days: RangeDays) => void;
}) => {
  const [split, setSplit] = useState(true);
  const share = summary.polarisShare;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <h2 className="text-heading-sm text-text-strong flex-1 font-medium">Tokens</h2>
        <label className="text-caption text-text-subtle flex items-center gap-2 pr-1.5">
          Split by Polaris sessions
          <Switch checked={split} onCheckedChange={setSplit} />
        </label>
        <SegmentedControl
          aria-label="Range"
          options={RANGE_OPTIONS}
          value={String(days)}
          onValueChange={(v) => {
            const next = RANGES.find((d) => String(d) === v);

            if (next !== undefined) onDays(next);
          }}
        />
      </div>
      {summary.tokens === 0 ? (
        <p className="text-caption text-text-subtle">
          No tokens in the last {days} days on{" "}
          {hostCount === 1 ? "this host" : `${hostCount} hosts`}.
        </p>
      ) : (
        <>
          <div className="flex gap-10">
            <Figure
              value={compactTokens(summary.tokens)}
              caption={`tokens on ${hostCount} host${hostCount === 1 ? "" : "s"}`}
            />
            <Figure value={costLabel(summary.cost)} caption={costCaption(summary)} />
            <Figure
              value={share === null ? "—" : `${Math.round(share * 100)}%`}
              caption="in Polaris sessions"
            />
          </div>
          <Chart summary={summary} split={split} />
          <ModelTable summary={summary} />
        </>
      )}
    </div>
  );
};

export const UsagePage = () => {
  const [days, setDays] = useState<RangeDays>(30);
  const data = useUsage(days);
  const now = useNow();
  const info = sectionInfo("usage");
  const summary = usageSummary({ buckets: data.buckets, days, now });

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {data.hostCount === 0 ? (
        <p className="text-caption text-text-subtle">No connected host reports usage yet.</p>
      ) : (
        <>
          <PlanLimits rows={limitRows(data.limits, now)} />
          <Tokens summary={summary} hostCount={data.hostCount} days={days} onDays={setDays} />
        </>
      )}
    </Column>
  );
};
