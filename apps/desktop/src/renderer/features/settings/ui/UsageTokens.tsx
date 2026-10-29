/**
 * Settings → Usage's tokens card (DESIGN.md, Settings; Paper S2): the three figures, the daily
 * chart and the by-model table. A pinned day narrows the table to that day's tokens and cost.
 */
import {
  Button,
  cn,
  harnessHue,
  hueVar,
  InstrumentCard,
  KICKER,
  Kicker,
  SegmentedControl,
  Switch,
} from "@polaris/ui";
import { useState } from "react";
import {
  compactTokens,
  costCaption,
  costLabel,
  formatShare,
  type ModelRow,
  type RangeDays,
  RANGES,
  shortDate,
  splitByDefault,
  type UsageSummary,
} from "../model/usage.ts";
import { UsageChart } from "./UsageChart.tsx";

export const CARD_CAPTION = "text-caption text-text-subtle";

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

/** The pinned day over the table: its name and the way back to the whole range. */
const PinnedDay = ({
  label,
  onShowAll,
}: {
  readonly label: string;
  readonly onShowAll: () => void;
}) => (
  <div className="h-row px-panel flex shrink-0 items-center gap-1.5" data-testid="usage-pinned">
    <span className="text-label text-text-strong">{label}</span>
    <span className="text-caption text-text-subtle">·</span>
    <Button variant="ghost" size="xs" onClick={onShowAll}>
      Show all
    </Button>
  </div>
);

const ModelTable = ({
  rows,
  pinned,
  onShowAll,
}: {
  readonly rows: ReadonlyArray<ModelRow>;
  /** The pinned day's name ("Sep 29", "Today"), or null for the whole range. */
  readonly pinned: string | null;
  readonly onShowAll: () => void;
}) => (
  <section
    aria-label={pinned === null ? "By model" : `By model, ${pinned}`}
    className="divide-hairline flex flex-col divide-y"
  >
    {pinned === null ? null : <PinnedDay label={pinned} onShowAll={onShowAll} />}
    <div className={cn(KICKER, "h-row px-panel flex shrink-0 items-center")}>
      <span className="flex-1">Model</span>
      <span className="w-[120px] shrink-0">Harness</span>
      <span className="w-[90px] shrink-0 text-right">Tokens</span>
      <span className="w-[110px] shrink-0 text-right">Cost</span>
    </div>
    {rows.length === 0 ? (
      <p className={cn(CARD_CAPTION, "px-panel flex h-9 items-center")}>No tokens on {pinned}</p>
    ) : null}
    {rows.map((row) => (
      <div
        key={`${row.harness}/${row.model}`}
        className="px-panel flex h-9 shrink-0 items-center"
        data-testid="usage-model-row"
      >
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

const dayName = (date: string, today: string | undefined) =>
  date === today ? "Today" : shortDate(date);

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const TokensCard = ({
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
  const [pin, setPin] = useState<string | null>(null);
  const split = chosen ?? splitByDefault(share);
  const hosts = `${hostCount} host${hostCount === 1 ? "" : "s"}`;
  const empty = summary.tokens === 0;
  const pinnedDay = summary.days.find((d) => d.date === pin);
  const today = summary.days.at(-1)?.date;

  const pinnedLabel = pinnedDay === undefined ? null : dayName(pinnedDay.date, today);

  const range = (
    <SegmentedControl
      pill
      aria-label="Range"
      options={RANGE_OPTIONS}
      value={String(days)}
      onValueChange={(v) => {
        const next = RANGES.find((d) => String(d) === v);

        if (next === undefined) return;
        setPin(null);
        onDays(next);
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
          <UsageChart
            summary={summary}
            split={split}
            pinned={pinnedDay?.date ?? null}
            onPin={setPin}
          />
        </>
      )}
    </div>
  );

  const table = (
    <ModelTable
      key="models"
      rows={pinnedDay?.models ?? summary.byModel}
      pinned={pinnedLabel}
      onShowAll={() => setPin(null)}
    />
  );

  return (
    <InstrumentCard
      aria-label="Tokens"
      className="w-full"
      header={{ title: "Tokens", control: range }}
      wells={empty ? [overview] : [overview, table]}
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
