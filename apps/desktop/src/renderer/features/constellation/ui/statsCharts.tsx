/**
 * The Stats popover's two wells (ENG-470): spend (headline, role split, costliest tasks) and
 * work (workers' time, review, update turns). Harness hue is identity, `accepted` is acceptance.
 */
import { cn, hueVar, Tooltip, TooltipContent, TooltipTrigger, washVar } from "@polaris/ui";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import type {
  LeadChart,
  ReviewChart,
  RoleShare,
  StatsPanel,
  TimeSegment,
  WorkerTime,
} from "../model/statsPanel.ts";
import { CellBar, CellColumns, type Density, TickRuler, TRACK } from "./statsPixels.tsx";

/** The wells' inner width at the popover's 400px. */
export const CHART_WIDTH = 334;

const fillOf = (harness: string | null) =>
  harness === null ? "var(--color-text-subtle)" : hueVar(harness);

const pct = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

const Swatch = ({
  fill,
  density = "solid",
  dashed = false,
}: {
  readonly fill: string;
  readonly density?: Density;
  readonly dashed?: boolean;
}) => (
  <span
    aria-hidden
    className={cn(
      "size-2 shrink-0 rounded-[1px]",
      dashed && "border-text-faint border border-dashed",
      density !== "solid" && "opacity-55"
    )}
    style={dashed ? undefined : { background: fill }}
  />
);

const Mono = ({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <span className={cn("text-text-subtle tabular font-mono text-[11px] leading-4", className)}>
    {children}
  </span>
);

export const Well = ({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) => (
  <div className="relative flex flex-col" data-testid={testId}>
    {children}
  </div>
);

const Part = ({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) => (
  <section className="border-hairline flex flex-col gap-2.5 border-t border-dashed px-3.5 py-3 first:border-t-0">
    <h3 className="flex items-baseline justify-between gap-3">
      <span className="text-label text-text-strong">{title}</span>
      {aside == null ? null : <Mono className="truncate">{aside}</Mono>}
    </h3>
    {children}
  </section>
);

const Fact = ({
  label,
  value,
  note = null,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string | null;
}) => {
  const row = (
    <div className="text-body flex items-baseline justify-between gap-3">
      <span className="text-text-subtle shrink-0">{label}</span>
      <span
        className={cn(
          "tabular truncate text-right",
          note === null ? "text-text-strong" : "text-text-faint"
        )}
      >
        {value}
      </span>
    </div>
  );

  return note === null ? (
    row
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent className="max-w-64">{note}</TooltipContent>
    </Tooltip>
  );
};

/** Workers at half density when they share the Lead's Harness, so the two still part. */
const roleDensity = (roles: ReadonlyArray<RoleShare>) => {
  const lead = roles.find((r) => r.role === "lead")?.harness ?? null;

  return (r: RoleShare): Density => (r.role === "worker" && r.harness === lead ? "half" : "solid");
};

const SpendHeadline = ({ panel }: { readonly panel: StatsPanel }) => {
  const [hover, setHover] = useState<string | null>(null);
  const density = roleDensity(panel.roles);
  const shown = panel.roles.filter((r) => r.share > 0);
  const { headline } = panel;
  const hue = panel.workers.harness ?? panel.roles[0]?.harness ?? null;

  return (
    <section
      className="relative flex flex-col gap-3 px-3.5 pt-3 pb-3.5"
      data-testid="stats-headline"
    >
      {hue === null ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 [mask-image:linear-gradient(to_bottom,black,transparent)] bg-cover bg-top opacity-40"
          style={{ backgroundImage: washVar(hue) }}
        />
      )}
      <div className="relative flex flex-col gap-1">
        <span className="text-caption text-text-subtle">{headline.caption}</span>
        <span className="flex items-baseline gap-1.5">
          <span
            className="text-text-strong tabular text-[34px] leading-[38px] font-normal tracking-[-0.02em]"
            data-testid="stats-primary"
          >
            {headline.primary}
          </span>
          {headline.unit === null ? null : (
            <span className="text-heading-sm text-text-subtle font-normal">{headline.unit}</span>
          )}
        </span>
        <Mono>{headline.secondary}</Mono>
      </div>
      <CellBar
        width={CHART_WIDTH}
        height={12}
        active={hover}
        label={`${panel.measure === "cost" ? "Cost" : "Tokens"} by role: ${shown.map((r) => `${r.label} ${pct(r.share)}`).join(", ")}`}
        parts={shown.map((r) => ({
          key: r.role,
          share: r.share,
          fill: fillOf(r.harness),
          density: density(r),
        }))}
      />
      <div className="grid grid-cols-2 gap-x-4">
        {panel.roles.map((r) => (
          <div
            key={r.role}
            className="flex min-w-0 flex-col"
            onPointerEnter={() => setHover(r.role)}
            onPointerLeave={() => setHover(null)}
            data-testid="stats-role"
          >
            <span className="text-caption text-text-subtle flex items-center gap-1.5">
              <Swatch fill={fillOf(r.harness)} density={density(r)} />
              {r.label}
              <Mono className="text-text-faint">{pct(r.share)}</Mono>
            </span>
            <span className="text-body text-text-strong tabular truncate">{r.value}</span>
            <Mono className="text-text-faint">{r.detail}</Mono>
          </div>
        ))}
      </div>
    </section>
  );
};

const Costliest = ({ panel }: { readonly panel: StatsPanel }) => {
  const [hover, setHover] = useState<string | null>(null);

  if (panel.tasks.length === 0) return null;

  return (
    <Part title="Costliest tasks" aside={panel.measure === "cost" ? "by cost" : "by tokens"}>
      <div className="flex flex-col gap-1.5" onPointerLeave={() => setHover(null)}>
        {panel.tasks.map((t) => (
          <div
            key={t.taskId}
            className="text-body flex items-center gap-2.5"
            onPointerEnter={() => setHover(t.taskId)}
            data-testid="stats-task"
          >
            <Mono className="w-7 shrink-0">{t.taskId}</Mono>
            <span
              className={cn(
                "min-w-0 flex-1 truncate transition-colors duration-[120ms]",
                hover === null || hover === t.taskId ? "text-text-default" : "text-text-faint"
              )}
            >
              {t.title}
            </span>
            <TickRuler
              width={78}
              share={t.share}
              fill={fillOf(panel.workers.harness)}
              dim={hover !== null && hover !== t.taskId}
            />
            <span className="text-text-strong tabular w-14 shrink-0 text-right">{t.value}</span>
          </div>
        ))}
      </div>
    </Part>
  );
};

export const SpendWell = ({ panel }: { readonly panel: StatsPanel }) => (
  <Well testId="stats-spend">
    <SpendHeadline panel={panel} />
    <Costliest panel={panel} />
  </Well>
);

const TIME_PAINT: Record<
  TimeSegment["key"],
  { readonly hued: boolean; readonly density: Density }
> = {
  working: { hued: true, density: "solid" },
  idle: { hued: true, density: "half" },
  slot: { hued: false, density: "solid" },
  lease: { hued: false, density: "half" },
  offline: { hued: false, density: "sparse" },
};

const timeFill = (s: TimeSegment, hue: string) =>
  TIME_PAINT[s.key].hued ? hue : "var(--color-text-faint)";

const Workers = ({ workers }: { readonly workers: WorkerTime }) => {
  const [hover, setHover] = useState<string | null>(null);
  const hue = fillOf(workers.harness);
  const recorded = workers.segments.filter((s) => s.ms !== null && s.ms > 0);
  const working = workers.segments.find((s) => s.key === "working");

  return (
    <Part title="Workers" aside={working?.ms == null ? null : `${working.text} working`}>
      <CellBar
        width={CHART_WIDTH}
        active={hover}
        label={`Workers' time: ${recorded.map((s) => `${s.label} ${s.text}`).join(", ")}`}
        parts={recorded.map((s) => ({
          key: s.key,
          share: s.share,
          fill: timeFill(s, hue),
          density: TIME_PAINT[s.key].density,
        }))}
      />
      <div className="flex flex-col gap-0.5" onPointerLeave={() => setHover(null)}>
        {workers.segments.map((s) => (
          <div
            key={s.key}
            className={cn(
              "flex items-center gap-2 transition-opacity duration-[120ms]",
              hover !== null && hover !== s.key && "opacity-50"
            )}
            onPointerEnter={() => setHover(s.ms === null ? null : s.key)}
            data-testid="stats-time"
          >
            <Swatch
              fill={timeFill(s, hue)}
              density={TIME_PAINT[s.key].density}
              dashed={s.ms === null}
            />
            <span className="min-w-0 flex-1">
              <Fact label={s.label} value={s.text} note={s.note} />
            </span>
            <Mono className="text-text-subtle w-8 shrink-0 text-right">
              {s.ms === null ? "" : pct(s.share)}
            </Mono>
          </div>
        ))}
      </div>
    </Part>
  );
};

/** Past this many first Claims, cells give way to a cell bar. */
const MAX_CELLS = 56;

const Review = ({ review }: { readonly review: ReviewChart }) => {
  const accepted = review.cells.filter((c) => c.accepted).length;

  return (
    <Part title="Review" aside={review.rate === null ? null : `${review.rate} first time`}>
      {review.cells.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          {review.cells.length > MAX_CELLS ? (
            <CellBar
              width={CHART_WIDTH}
              label={review.summary}
              parts={[
                { key: "accepted", share: accepted, fill: "var(--color-accepted)" },
                { key: "rest", share: review.cells.length - accepted, fill: TRACK },
              ]}
            />
          ) : (
            <div role="img" aria-label={review.summary} className="flex flex-wrap gap-[3px]">
              {review.cells.map((cell, i) => (
                <span
                  key={cell.id}
                  data-testid="stats-claim-cell"
                  data-accepted={cell.accepted || undefined}
                  className={cn(
                    "polaris-stats-cell size-3 rounded-[2px]",
                    cell.accepted ? "bg-accepted" : "border-text-faint border border-dashed"
                  )}
                  style={{ animationDelay: `${Math.round((i / review.cells.length) * 220)}ms` }}
                />
              ))}
            </div>
          )}
          <span className="text-caption text-text-subtle">{review.summary}</span>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <Fact label="Claim to review" value={review.claimToReview} />
        <Fact label="Sent back" value={review.sentBack} />
      </div>
    </Part>
  );
};

/** One column per update turn; hovering or ← → reads one out under the chart. */
const Lead = ({ lead, harness }: { readonly lead: LeadChart; readonly harness: string | null }) => {
  const last = lead.columns.length - 1;
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? last;

  const onKey = (e: KeyboardEvent) => {
    const moves = new Map([
      ["ArrowLeft", shown - 1],
      ["ArrowRight", shown + 1],
      ["Home", 0],
      ["End", last],
    ]);

    const next = moves.get(e.key);

    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  return (
    <Part title="Lead" aside={lead.title}>
      {lead.columns.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            tabIndex={0}
            aria-label={`${lead.title}, by ${lead.measure}. ${lead.columns[shown]?.label ?? ""}`}
            className="rounded-[2px] outline-offset-4"
            onKeyDown={onKey}
            onPointerLeave={() => setActive(null)}
            data-testid="stats-digests"
          >
            <CellColumns
              columns={lead.columns}
              active={shown}
              fill={fillOf(harness)}
              width={CHART_WIDTH}
              onActive={setActive}
            />
          </div>
          <Mono className="truncate">{lead.columns[shown]?.label}</Mono>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {lead.facts.map((f) => (
          <Fact
            key={f.label}
            label={f.label}
            value={f.value}
            note={f.value === "not recorded" ? lead.note : null}
          />
        ))}
      </div>
    </Part>
  );
};

export const WorkWell = ({
  panel,
  children,
}: {
  readonly panel: StatsPanel;
  readonly children?: ReactNode;
}) => (
  <Well testId="stats-work">
    <Workers workers={panel.workers} />
    <Review review={panel.review} />
    <Lead lead={panel.lead} harness={panel.roles.find((r) => r.role === "lead")?.harness ?? null} />
    {children}
  </Well>
);
