/**
 * The Constellation glance's hero (Paper X-H Variant 1): the graph as a star chart. Static SVG;
 * only the flow dots off working Tasks move, by transform, and never under Reduce Motion.
 */
import type { HarnessKind } from "@polaris/protocol";
import { cn, Kicker, reducedMotion, Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import { type CSSProperties, useMemo } from "react";
import {
  CHART,
  type ChartBundle,
  type ChartEdge,
  type ChartStar,
  type StarChart,
} from "../model/chart.ts";
import { progressOf } from "../model/glance.ts";
import type { Segment, StripTone } from "../model/index.ts";
import { GateStar, LeadStar, Star, StarIcon, toneFill } from "./stars.tsx";

type Lookup = ReadonlyMap<string, Segment>;

const toneAt = (states: Lookup, id: string | null): StripTone =>
  id === null ? "accepted" : (states.get(id)?.tone ?? "waiting");

const LEGEND: ReadonlyArray<readonly [StripTone, string]> = [
  ["accepted", "accepted"],
  ["working", "working"],
  ["review", "in review"],
  ["needs-you", "needs you"],
  ["failed", "failed"],
  ["blocked", "blocked"],
  ["waiting", "waiting"],
];

const ID_TONE: Readonly<Partial<Record<StripTone, string>>> = {
  accepted: "text-accepted-text",
  "needs-you": "text-needs-you-text",
  failed: "text-failed-text",
};

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where a line starts: the Task's star, or a bundled parent's band edge. */
const sourceOf = (e: ChartEdge, at: ReadonlyMap<string, ChartStar>): Point | undefined =>
  e.bundle ?? (e.from === null ? undefined : at.get(e.from));

/** The Tasks a line waits on: its source, or every leaf of a bundled parent. */
const waitsOn = (e: ChartEdge): ReadonlyArray<string> =>
  e.bundle?.leaves ?? (e.from === null ? [] : [e.from]);

const doneAt = (states: Lookup, e: ChartEdge) =>
  e.from !== null && waitsOn(e).every((id) => toneAt(states, id) === "accepted");

const bundleLabel = (parent: string, bundle: ChartBundle) =>
  `${parent} · ${bundle.leaves.length} ${bundle.leaves.length === 1 ? "task" : "tasks"}`;

const QUIET: ReadonlySet<StripTone> = new Set(["accepted", "waiting", "blocked"]);

/** Faint background stars, the same for the same graph. */
const dust = (seed: string, width: number, height: number) => {
  let h = Array.from(seed).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  const next = () => {
    h = (h * 1_103_515_245 + 12_345) >>> 0;

    return h / 2 ** 32;
  };

  return Array.from({ length: Math.round((width * height) / 16_000) }, () => ({
    x: Math.floor(next() * width),
    y: Math.floor(CHART.top + next() * (height - CHART.top)),
  }));
};

const Bands = ({ chart }: { readonly chart: StarChart }) => (
  <g className="[shape-rendering:crispEdges]">
    {chart.bands.map((b, n) => (
      <g key={b.key}>
        {n % 2 === 1 ? (
          <rect
            x={0}
            y={b.y}
            width={chart.width}
            height={b.height}
            fill="var(--color-text-strong)"
            opacity={0.025}
          />
        ) : null}
        {n === 0 ? null : (
          <rect x={0} y={b.y} width={chart.width} height={1} fill="var(--color-hairline)" />
        )}
      </g>
    ))}
  </g>
);

const leadPath = (chart: StarChart, to: ChartStar) => {
  const { x, y } = chart.lead;
  const mid = (x + to.x) / 2;

  return `M${x + 12} ${y + 0.5} C ${mid} ${y + 0.5}, ${mid} ${to.y + 0.5}, ${to.x} ${to.y + 0.5}`;
};

const Edge = ({
  edge,
  chart,
  states,
  at,
}: {
  readonly edge: ChartEdge;
  readonly chart: StarChart;
  readonly states: Lookup;
  readonly at: ReadonlyMap<string, ChartStar>;
}) => {
  const to = at.get(edge.to);

  if (to === undefined) return null;

  if (edge.from === null)
    return (
      <path
        d={leadPath(chart, to)}
        fill="none"
        stroke="var(--color-text-faint)"
        strokeOpacity={0.6}
      />
    );
  const from = sourceOf(edge, at);

  if (from === undefined) return null;
  const solid = doneAt(states, edge);

  return (
    <line
      x1={from.x}
      y1={from.y + 0.5}
      x2={to.x}
      y2={to.y + 0.5}
      data-edge={solid ? "accepted" : "pending"}
      stroke={solid ? "var(--color-accepted)" : "var(--color-text-subtle)"}
      strokeOpacity={solid ? 0.7 : 0.8}
      strokeDasharray={solid ? undefined : "1 3"}
    />
  );
};

/** Three dots running from a working Task along its edge; a still trail under Reduce Motion. */
const Flow = ({
  from,
  to,
  harness,
  still,
}: {
  readonly from: Point;
  readonly to: Point;
  readonly harness: HarnessKind | null;
  readonly still: boolean;
}) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const fill = toneFill("working", harness);

  return (
    <g
      transform={`translate(${from.x} ${from.y}) rotate(${angle})`}
      className="[shape-rendering:crispEdges]"
    >
      {[0, 1, 2].map((n) =>
        still ? (
          <rect
            key={n}
            x={length * (0.55 + n * 0.15) - 1}
            y={-1}
            width={2}
            height={2}
            fill={fill}
            opacity={0.55 + n * 0.2}
          />
        ) : (
          <rect
            key={n}
            data-flow
            className="polaris-flow"
            x={-1}
            y={-1}
            width={2}
            height={2}
            fill={fill}
            // SAFETY: a custom property is a valid style key; React passes it through unchanged.
            style={{ "--flow-len": `${length}px`, animationDelay: `${n * -0.8}s` } as CSSProperties}
          />
        )
      )}
    </g>
  );
};

const Label = ({
  star,
  segment,
  step,
  note,
}: {
  readonly star: ChartStar;
  readonly segment: Segment | undefined;
  readonly step: number;
  /** A gate's second line: "gate · waits 5". */
  readonly note: string | null;
}) => {
  const tone = segment?.tone ?? "waiting";
  const width = Math.max(40, Math.min(150, step - 8));
  const left = Math.min(Math.max(4, star.x - width / 2), CHART.width - width - 4);
  const idOnly = step < 72;

  return (
    <div
      className="absolute flex flex-col items-center font-mono text-[11px] leading-[14px] whitespace-nowrap"
      style={{ left, top: star.y + (star.gate ? 18 : 10), width }}
      data-testid="chart-star"
      data-task={star.id}
      data-tone={tone}
    >
      <span className="flex max-w-full min-w-0">
        <span className={cn("shrink-0", ID_TONE[tone] ?? "text-text-strong")}>{star.id}</span>
        {idOnly ? null : (
          <span
            className={cn(
              "ml-1.5 min-w-0 truncate",
              QUIET.has(tone) ? "text-text-subtle" : "text-text-default"
            )}
          >
            {star.title}
          </span>
        )}
        <span className="sr-only">, {segment?.word ?? "waiting"}</span>
      </span>
      {note === null ? null : <span className="text-text-subtle">{note}</span>}
    </div>
  );
};

const gateNote = (chart: StarChart, states: Lookup, gate: ChartStar) => {
  if (toneAt(states, gate.id) === "accepted") return "gate · accepted";

  const waits = chart.edges.filter((e) => e.to === gate.id && !doneAt(states, e)).length;

  return waits === 0 ? "gate · ready" : `gate · waits ${waits}`;
};

const BandLabels = ({ chart }: { readonly chart: StarChart }) => (
  <>
    {chart.bands.map((b) =>
      b.name === null ? null : (
        <div
          key={b.key}
          className="absolute left-3 flex items-center gap-1.5"
          style={{ top: b.y + 5 }}
        >
          {b.badge === null ? null : (
            <span className="border-hairline text-text-subtle grid h-3.5 min-w-3.5 place-items-center rounded-[3px] border px-0.5 font-mono text-[9px] leading-none">
              {b.badge}
            </span>
          )}
          <span className="text-text-subtle max-w-48 truncate font-mono text-[11px] leading-[14px]">
            {b.name}
          </span>
        </div>
      )
    )}
  </>
);

const Legend = ({
  segments,
  top,
}: {
  readonly segments: ReadonlyArray<Segment>;
  readonly top: number;
}) => {
  const present = LEGEND.filter(([tone]) => segments.some((s) => s.tone === tone));

  return (
    <div
      className="text-text-subtle absolute right-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-[14px]"
      style={{ top }}
      data-testid="chart-legend"
    >
      {present.map(([tone, word]) => (
        <span key={tone} className="flex items-center gap-1.5">
          <span className="grid size-3.5 place-items-center">
            <StarIcon
              tone={tone}
              harness={segments.find((s) => s.tone === tone)?.harness ?? null}
            />
          </span>
          {word}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <svg width={14} height={2} aria-hidden>
          <line
            x1={0}
            y1={1}
            x2={14}
            y2={1}
            stroke="var(--color-text-subtle)"
            strokeDasharray="1 3"
          />
        </svg>
        upstream not yet accepted
      </span>
    </div>
  );
};

const ProgressKicker = ({
  segments,
  waves,
}: {
  readonly segments: ReadonlyArray<Segment>;
  readonly waves: number;
}) => {
  const p = progressOf(segments);

  return (
    <div className="absolute top-3 right-3 left-3 flex items-center gap-2">
      <Kicker className="min-w-0 flex-1 truncate">
        <span className="text-accepted-text">
          {p.accepted} of {p.total} accepted
        </span>
        {p.working === 0 ? null : <> · {p.working} working</>}
        {p.needsYou === 0 ? null : (
          <>
            {" · "}
            <span className="text-needs-you-text">{p.needsYou} needs you</span>
          </>
        )}
      </Kicker>
      <Kicker className="shrink-0">{waves === 1 ? "wave 1" : `wave 1 → ${waves}`}</Kicker>
    </div>
  );
};

/** The chart is aria-hidden; a bundled line answers hover and focus with its parent's leaves. */
const BundleHits = ({
  chart,
  at,
}: {
  readonly chart: StarChart;
  readonly at: ReadonlyMap<string, ChartStar>;
}) => (
  <svg
    width={chart.width}
    height={chart.height}
    className="pointer-events-none absolute inset-0"
    role="group"
    aria-label="Dependencies on parents"
  >
    {chart.edges.map((e) => {
      const to = at.get(e.to);

      if (e.bundle === null || e.from === null || to === undefined) return null;
      const label = bundleLabel(e.from, e.bundle);

      return (
        <Tooltip key={`${e.from}>${e.to}`}>
          <TooltipTrigger asChild>
            <line
              x1={e.bundle.x}
              y1={e.bundle.y + 0.5}
              x2={to.x}
              y2={to.y + 0.5}
              data-bundle={e.from}
              tabIndex={0}
              aria-label={`${label} before ${e.to}: ${e.bundle.leaves.join(", ")}`}
              stroke="var(--color-ring)"
              strokeOpacity={0}
              strokeWidth={8}
              style={{ pointerEvents: "stroke" }}
              className="outline-none hover:[stroke-opacity:0.15] focus-visible:[stroke-opacity:0.35]"
            />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {label}
            <span className="text-text-subtle"> · {e.bundle.leaves.join(", ")}</span>
          </TooltipContent>
        </Tooltip>
      );
    })}
  </svg>
);

export const StarChartHero = ({
  chart,
  segments,
  leadHarness,
  seed,
}: {
  readonly chart: StarChart;
  readonly segments: ReadonlyArray<Segment>;
  readonly leadHarness: HarnessKind | null;
  /** Places the background dust: the Constellation's id. */
  readonly seed: string;
}) => {
  const states = useMemo(() => new Map(segments.map((s) => [s.key, s])), [segments]);
  const at = useMemo(() => new Map(chart.stars.map((s) => [s.id, s])), [chart]);
  const specks = useMemo(() => dust(seed, chart.width, chart.height), [seed, chart]);
  const still = reducedMotion();

  const flows = chart.edges.flatMap((e) => {
    const from = sourceOf(e, at);
    const to = at.get(e.to);

    const working = waitsOn(e)
      .map((id) => states.get(id))
      .find((s) => s?.tone === "working");

    return from === undefined || to === undefined || working === undefined
      ? []
      : [{ key: `${e.from ?? ""}>${e.to}`, from, to, harness: working.harness }];
  });

  return (
    <div
      className="relative"
      style={{ width: chart.width, height: chart.height }}
      data-testid="star-chart"
    >
      <svg width={chart.width} height={chart.height} className="absolute inset-0" aria-hidden>
        <Bands chart={chart} />
        <g fill="var(--color-text-strong)" opacity={0.3} className="[shape-rendering:crispEdges]">
          {specks.map((p) => (
            <rect key={`${p.x}.${p.y}`} x={p.x} y={p.y} width={1} height={1} />
          ))}
        </g>
        {chart.edges.map((e) => (
          <Edge key={`${e.from ?? ""}>${e.to}`} edge={e} chart={chart} states={states} at={at} />
        ))}
        {flows.map((f) => (
          <Flow key={f.key} from={f.from} to={f.to} harness={f.harness} still={still} />
        ))}
        <rect
          x={chart.lead.x - 14}
          y={chart.lead.y - 14}
          width={28}
          height={28}
          fill="var(--color-well)"
        />
        <LeadStar harness={leadHarness} x={chart.lead.x} y={chart.lead.y} />
        {chart.stars.map((s) =>
          s.gate ? (
            <GateStar key={s.id} x={s.x} y={s.y} accepted={toneAt(states, s.id) === "accepted"} />
          ) : (
            <Star
              key={s.id}
              tone={toneAt(states, s.id)}
              harness={states.get(s.id)?.harness ?? null}
              x={s.x}
              y={s.y}
            />
          )
        )}
      </svg>
      <BundleHits chart={chart} at={at} />
      <ProgressKicker segments={segments} waves={chart.waves} />
      <BandLabels chart={chart} />
      <span
        className="text-text-subtle absolute font-mono text-[11px] leading-[14px]"
        style={{ left: chart.lead.x - 14, top: chart.lead.y + 16 }}
      >
        lead
      </span>
      {chart.stars.map((s) => (
        <Label
          key={s.id}
          star={s}
          segment={states.get(s.id)}
          step={chart.step}
          note={s.gate ? gateNote(chart, states, s) : null}
        />
      ))}
      <Legend segments={segments} top={chart.height - CHART.bottom + 10} />
    </div>
  );
};
