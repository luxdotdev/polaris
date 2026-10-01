/**
 * Settings → Usage (DESIGN.md, Settings; Paper S2): Plan Limits first, then
 * tokens over 7 / 30 / 90 days, the three figures (tokens, cost, share in Polaris), a
 * stacked daily chart in Harness hues with a per-day tooltip, and a by-model table where
 * estimated costs carry a "~".
 */
import { cn, hueVar, SegmentedControl, Switch, Tile, Dither, harnessHue } from "@polaris/ui";
import { useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import { useRunningHarnesses } from "../../harness/index.ts";
import { type LimitRow, type LimitWindow, limitRows, METER_CELLS } from "../model/planLimits.ts";
import { sectionInfo } from "../model/sections.ts";
import {
  compactTokens,
  costCaption,
  costLabel,
  formatShare,
  splitByDefault,
  pricedEstimate,
  type RangeDays,
  RANGES,
  usageSummary,
  type UsageSummary,
} from "../model/usage.ts";
import { Column, Group, Heading, PageHeader } from "./parts.tsx";
import { UsageChart } from "./UsageChart.tsx";
import { useUsage } from "./useUsage.ts";

/** Paper S2's meter: 40 cells of 4×10px with 1px gaps. */
const CELL = 4;

const PITCH = CELL + 1;

const METER_WIDTH = METER_CELLS * PITCH - 1;

/**
 * What's left as discrete cells: filled in the Harness hue, empty as faint
 * tracks. One SVG with crisp edges (`pixelated`), so the 1px gaps survive a fractional x.
 */
const Meter = ({ harness, filled }: { readonly harness: string; readonly filled: number }) => (
  <svg
    aria-hidden
    width={METER_WIDTH}
    height={10}
    viewBox={`0 0 ${METER_WIDTH} 10`}
    className="pixelated block shrink-0"
    data-testid="plan-meter"
    data-filled={filled}
  >
    {Array.from({ length: METER_CELLS }, (_, i) => (
      <rect
        key={i}
        x={i * PITCH}
        width={CELL}
        height={10}
        style={{ fill: i < filled ? hueVar(harness) : "light-dark(#0000000f, #ffffff12)" }}
      />
    ))}
  </svg>
);

const WindowCell = ({ harness, win }: { readonly harness: string; readonly win: LimitWindow }) => (
  <div
    className="flex min-w-0 flex-col gap-1.5"
    style={{ flex: `1 0 ${METER_WIDTH}px` }}
    data-testid="plan-window"
  >
    <div className="flex justify-between gap-2" style={{ maxWidth: METER_WIDTH }}>
      <span className="text-caption text-text-subtle truncate">{win.label}</span>
      <span className="text-caption text-text-default tabular shrink-0">{win.left ?? ""}</span>
    </div>
    <Meter harness={harness} filled={win.filledCells} />
    <span className="text-caption text-text-subtle">{win.note}</span>
  </div>
);

const HarnessTile = ({ harness, size }: { readonly harness: string; readonly size: 28 | 40 }) => (
  <Tile hue={harness} size={size}>
    <Dither hue={harness} size={size === 40 ? 20 : 12} />
  </Tile>
);

const LimitRowView = ({ row }: { readonly row: LimitRow }) => (
  <div
    className={cn(
      "px-panel gap-section flex py-3.5",
      row.windows.length > 2 ? "items-start" : "items-center"
    )}
  >
    <div className="flex w-[184px] shrink-0 items-center gap-2.5">
      <HarnessTile harness={row.harness} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className="text-label text-text-default truncate">{row.name}</span>
        <span className="text-caption text-text-subtle truncate">{row.caption}</span>
      </span>
    </div>
    {/* Windows wrap to another line rather than clip: two fit beside the label, a third goes under. */}
    <div className="gap-x-section flex min-w-0 flex-1 flex-wrap gap-y-3">
      {row.windows.map((win) => (
        <WindowCell key={win.key} harness={row.harness} win={win} />
      ))}
    </div>
  </div>
);

/** OpenCode reports a limit only when a provider refuses work, so its absence needs saying (Paper S2). */
const OPENCODE_ASIDE = "OpenCode reports a limit only once you reach it";

const PlanLimits = ({
  rows,
  harnesses,
}: {
  readonly rows: ReadonlyArray<LimitRow>;
  /** Harnesses with Usage in the range. */
  readonly harnesses: ReadonlyArray<string>;
}) => (
  <div className="flex flex-col gap-2.5">
    <Heading
      aside={
        harnesses.includes("opencode") && !rows.some((r) => r.harness === "opencode") ? (
          <span className="text-caption text-text-subtle">{OPENCODE_ASIDE}</span>
        ) : null
      }
    >
      Plan limits
    </Heading>
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
        <span className="text-label text-text-default flex-1 truncate">{row.model}</span>
        <span className="text-caption text-text-subtle flex w-[120px] shrink-0 items-center gap-1.5">
          <span className="size-2 shrink-0" style={{ background: hueVar(row.harness) }} />
          {harnessHue(row.harness).name}
        </span>
        <span className="text-label font-regular text-text-default tabular w-[90px] shrink-0 text-right">
          {compactTokens(row.tokens)}
        </span>
        <span className="text-label font-regular text-text-subtle tabular w-[110px] shrink-0 text-right">
          {costLabel(row.cost)}
        </span>
      </div>
    ))}
  </Group>
);

const RANGE_OPTIONS = RANGES.map((d) => ({ value: String(d), label: `${d} days` }));

const Tokens = ({
  summary,
  hostCount,
  indexing,
  days,
  onDays,
}: {
  readonly summary: UsageSummary;
  readonly hostCount: number;
  readonly days: RangeDays;
  readonly onDays: (days: RangeDays) => void;
  /** A Daemon is still reading Harness logs: say so, and don't claim there are no tokens. */
  readonly indexing: boolean;
}) => {
  const share = summary.polarisShare;
  // Null until the user flips it: until then it follows `splitByDefault`.
  const [chosen, setSplit] = useState<boolean | null>(null);
  const split = chosen ?? splitByDefault(share);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <h2 className="text-heading-sm text-text-strong flex-1 font-medium">Tokens</h2>
        <label className="text-caption text-text-subtle flex items-center gap-2 pr-1.5">
          Split by Polaris sessions
          <Switch checked={split} onCheckedChange={setSplit} />
        </label>
        <SegmentedControl
          variant="well"
          aria-label="Range"
          options={RANGE_OPTIONS}
          value={String(days)}
          onValueChange={(v) => {
            const next = RANGES.find((d) => String(d) === v);

            if (next !== undefined) onDays(next);
          }}
        />
      </div>
      {indexing ? (
        <p className="text-caption text-text-subtle" data-testid="usage-indexing" role="status">
          Indexing usage…
        </p>
      ) : null}
      {summary.tokens === 0 ? (
        indexing ? null : (
          <p className="text-caption text-text-subtle">
            No tokens in the last {days} days on{" "}
            {hostCount === 1 ? "this host" : `${hostCount} hosts`}.
          </p>
        )
      ) : (
        <>
          <div className="flex gap-10" data-testid="usage-figures">
            <Figure
              value={compactTokens(summary.tokens)}
              caption={`tokens on ${hostCount} host${hostCount === 1 ? "" : "s"}`}
            />
            <Figure value={costLabel(summary.cost)} caption={costCaption(summary.cost)} />
            <Figure value={formatShare(share)} caption="in Polaris sessions" />
          </div>
          <UsageChart summary={summary} split={split} />
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
  const running = useRunningHarnesses();
  const info = sectionInfo("usage");
  const summary = usageSummary({ buckets: data.buckets, days, now, estimate: pricedEstimate });

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {data.hostCount === 0 ? (
        <p className="text-caption text-text-subtle">No connected host reports usage yet.</p>
      ) : (
        <>
          <PlanLimits rows={limitRows(data.limits, now, running)} harnesses={summary.harnesses} />
          <Tokens
            summary={summary}
            hostCount={data.hostCount}
            indexing={data.indexing}
            days={days}
            onDays={setDays}
          />
        </>
      )}
    </Column>
  );
};
