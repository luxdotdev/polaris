/**
 * Settings → Usage (DESIGN.md, Settings; Chrome redesign, Paper X-J): two instrument cards. Plan
 * limits, then tokens over 7 / 30 / 90 days: the three figures (tokens, cost, share in Polaris), a
 * stacked daily chart in Harness hues with a per-day tooltip, and a by-model table where
 * estimated costs carry a "~".
 */
import {
  cn,
  Dither,
  harnessHue,
  hueVar,
  InstrumentCard,
  KICKER,
  Kicker,
  SegmentedControl,
  Switch,
  Tile,
} from "@polaris/ui";
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
import { Column, PageHeader } from "./parts.tsx";
import { UsageByConstellation } from "./UsageByConstellation.tsx";
import { UsageChart } from "./UsageChart.tsx";
import { useUsage } from "./useUsage.ts";

/** Paper S2's meter: 40 cells of 4×10px with 1px gaps. */
const CELL = 4;

const PITCH = CELL + 1;

const METER_WIDTH = METER_CELLS * PITCH - 1;

const cellFill = (harness: string, i: number, filled: number) =>
  i < filled ? hueVar(harness) : "light-dark(#0000000f, #ffffff12)";

/**
 * What's left as discrete cells: filled in the Harness hue, empty as faint
 * tracks. One SVG with crisp edges (`pixelated`), so the 1px gaps survive a
 * fractional x. The pace marker is one of the cells in `text-strong`, a pixel
 * taller each way: where the fill would end if used evenly. Never a signal colour.
 */
const Meter = ({
  harness,
  filled,
  pace,
}: {
  readonly harness: string;
  readonly filled: number;
  readonly pace: number | null;
}) => (
  <svg
    aria-hidden
    width={METER_WIDTH}
    height={12}
    viewBox={`0 0 ${METER_WIDTH} 12`}
    className="pixelated block shrink-0"
    data-testid="plan-meter"
    data-filled={filled}
    data-pace={pace ?? undefined}
  >
    {Array.from({ length: METER_CELLS }, (_, i) =>
      i === pace ? (
        <rect
          key={i}
          x={i * PITCH}
          width={CELL}
          height={12}
          style={{ fill: "var(--color-text-strong)" }}
        />
      ) : (
        <rect
          key={i}
          x={i * PITCH}
          y={1}
          width={CELL}
          height={10}
          style={{ fill: cellFill(harness, i, filled) }}
        />
      )
    )}
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
    <Meter harness={harness} filled={win.filledCells} pace={win.pace?.cell ?? null} />
    <span className="text-caption text-text-subtle flex flex-col">
      <span>{win.note}</span>
      {win.pace === null ? null : <span data-testid="plan-forecast">{win.pace.words}</span>}
      {win.pace?.sessions == null ? null : <span>{win.pace.sessions}</span>}
    </span>
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

const CARD_CAPTION = "text-caption text-text-subtle";

const PlanLimits = ({
  rows,
  harnesses,
}: {
  readonly rows: ReadonlyArray<LimitRow>;
  /** Harnesses with Usage in the range. */
  readonly harnesses: ReadonlyArray<string>;
}) => {
  const quietOpenCode =
    harnesses.includes("opencode") && !rows.some((r) => r.harness === "opencode");

  if (rows.length === 0) {
    return (
      <p className={CARD_CAPTION}>
        No plan limits reported yet. A harness reports its limits as it runs.
      </p>
    );
  }

  return (
    <InstrumentCard
      aria-label="Plan limits"
      className="w-full"
      header={{
        title: "Plan limits",
        control: <span className={CARD_CAPTION}>What's left in each window, counting down</span>,
      }}
      wells={[
        <div key="rows" className="divide-hairline flex flex-col divide-y">
          {rows.map((row) => (
            <LimitRowView key={row.harness} row={row} />
          ))}
        </div>,
      ]}
      footer={{
        status: rows.map((row) => `${row.name} ${row.fresh}`).join(" · "),
        action: quietOpenCode ? <span className={CARD_CAPTION}>{OPENCODE_ASIDE}</span> : undefined,
      }}
    />
  );
};

/** One line each: a caption too long for the row truncates and keeps its words in a title. */
const Figure = ({
  value,
  caption,
  shrinks = false,
}: {
  readonly value: string;
  readonly caption: string;
  /** Gives way first when the row is narrow (the cost caption, the longest). */
  readonly shrinks?: boolean;
}) => (
  <div className={cn("flex flex-col gap-1", shrinks ? "min-w-0" : "shrink-0")}>
    <span className="text-display text-text-strong tabular font-medium whitespace-nowrap">
      {value}
    </span>
    <Kicker className="truncate whitespace-nowrap" title={caption}>
      {caption}
    </Kicker>
  </div>
);

const ModelTable = ({ summary }: { readonly summary: UsageSummary }) => (
  <section aria-label="By model" className="divide-hairline flex flex-col divide-y">
    <div className={cn(KICKER, "h-row px-panel flex shrink-0 items-center")}>
      <span className="flex-1">Model</span>
      <span className="w-[120px] shrink-0">Harness</span>
      <span className="w-[90px] shrink-0 text-right">Tokens</span>
      <span className="w-[110px] shrink-0 text-right">Cost</span>
    </div>
    {summary.byModel.map((row) => (
      <div key={`${row.harness}/${row.model}`} className="px-panel flex h-9 shrink-0 items-center">
        <span className="text-label text-text-default flex-1 truncate" title={row.model}>
          {row.model}
        </span>
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
  </section>
);

const RANGE_OPTIONS = RANGES.map((d) => ({ value: String(d), label: `${d} days` }));

const Tokens = ({
  summary,
  now,
  hostCount,
  indexing,
  days,
  onDays,
}: {
  readonly summary: UsageSummary;
  readonly now: number;
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
  const hosts = `${hostCount} host${hostCount === 1 ? "" : "s"}`;
  const empty = summary.tokens === 0;

  const range = (
    <SegmentedControl
      pill
      aria-label="Range"
      options={RANGE_OPTIONS}
      value={String(days)}
      onValueChange={(v) => {
        const next = RANGES.find((d) => String(d) === v);

        if (next !== undefined) onDays(next);
      }}
    />
  );

  const overview = (
    <div className="p-panel flex flex-col gap-4">
      {indexing ? (
        <p className={CARD_CAPTION} data-testid="usage-indexing" role="status">
          Indexing usage…
        </p>
      ) : null}
      {empty ? (
        indexing ? null : (
          <p className={CARD_CAPTION}>
            No tokens in the last {days} days on {hostCount === 1 ? "this host" : hosts}.
          </p>
        )
      ) : (
        <>
          <div className="flex gap-12" data-testid="usage-figures">
            <Figure value={compactTokens(summary.tokens)} caption={`tokens · ${hosts}`} />
            <Figure value={costLabel(summary.cost)} caption={costCaption(summary.cost)} shrinks />
            <Figure value={formatShare(share)} caption="in Polaris sessions" />
          </div>
          <UsageChart summary={summary} split={split} />
        </>
      )}
    </div>
  );

  return (
    <InstrumentCard
      aria-label="Tokens"
      className="w-full"
      header={{ title: "Tokens", control: range }}
      wells={empty ? [overview] : [overview, <ModelTable key="models" summary={summary} />]}
      footer={{
        status: `${hosts} · ${days} days · as of ${clock(now)}`,
        action: empty ? undefined : (
          <label className="text-caption text-text-subtle flex items-center gap-2">
            Split by Polaris sessions
            <Switch checked={split} onCheckedChange={setSplit} />
          </label>
        ),
      }}
    />
  );
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

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
            now={now}
            hostCount={data.hostCount}
            indexing={data.indexing}
            days={days}
            onDays={setDays}
          />
          {summary.tokens === 0 ? null : (
            <UsageByConstellation buckets={data.buckets} now={now} estimate={pricedEstimate} />
          )}
        </>
      )}
    </Column>
  );
};
