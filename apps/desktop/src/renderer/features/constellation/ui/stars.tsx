/**
 * The star chart's pixel glyphs (Paper X-H, "Reading the stars"): every state keeps its own
 * shape, so colour is never alone (rule/no-colour-alone).
 */
import type { HarnessKind } from "@polaris/protocol";
import { hueVar } from "@polaris/ui";
import type { StripTone } from "../model/index.ts";

interface Pixels {
  readonly size: number;
  readonly paths: ReadonlyArray<{ readonly d: string; readonly opacity?: number }>;
}

const GLYPH: Readonly<Record<StripTone, Pixels>> = {
  accepted: {
    size: 9,
    paths: [{ d: "M3 3h3v3h-3zM4 0h1v3h-1zM4 6h1v3h-1zM0 4h3v1h-3zM6 4h3v1h-3z" }],
  },
  working: {
    size: 15,
    paths: [
      {
        d: "M1 7h1v1h-1zM3 2h1v1h-1zM5 12h1v1h-1zM11 1h1v1h-1zM13 9h1v1h-1zM9 13h1v1h-1z",
        opacity: 0.5,
      },
      { d: "M6 6h3v3h-3zM7 3h1v3h-1zM7 9h1v3h-1zM3 7h3v1h-3zM9 7h3v1h-3z" },
    ],
  },
  review: {
    size: 7,
    paths: [
      {
        d: "M2 0h3v1h-3zM2 6h3v1h-3zM0 2h1v3h-1zM6 2h1v3h-1zM1 1h1v1h-1zM5 1h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1z",
      },
    ],
  },
  "needs-you": {
    size: 10,
    paths: [{ d: "M1 2h2v5h-2zM3 0h2v7h-2zM5 1h2v6h-2zM7 3h2v4h-2zM2 7h6v3h-6z" }],
  },
  failed: {
    size: 7,
    paths: [
      {
        d: "M0 0h2v1h-2zM1 1h2v1h-2zM2 2h2v1h-2zM3 3h1v1h-1zM4 4h2v1h-2zM5 5h2v1h-2zM6 6h1v1h-1zM5 0h2v1h-2zM4 1h2v1h-2zM2 4h2v1h-2zM1 5h2v1h-2zM0 6h2v1h-2z",
      },
    ],
  },
  blocked: {
    size: 7,
    paths: [
      {
        d: "M2 0h3v1h-3zM2 6h3v1h-3zM0 2h1v3h-1zM6 2h1v3h-1zM1 1h1v1h-1zM5 1h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1z",
      },
      { d: "M2 3h3v1h-3z" },
    ],
  },
  waiting: { size: 5, paths: [{ d: "M1 0h3v1h-3zM1 4h3v1h-3zM0 1h1v3h-1zM4 1h1v3h-1z" }] },
};

const FILL: Readonly<Record<Exclude<StripTone, "working">, string>> = {
  accepted: "var(--color-accepted)",
  review: "var(--color-text-strong)",
  "needs-you": "var(--color-needs-you)",
  failed: "var(--color-failed)",
  blocked: "var(--color-text-subtle)",
  waiting: "var(--color-text-subtle)",
};

export const toneFill = (tone: StripTone, harness: HarnessKind | null) =>
  tone === "working"
    ? harness === null
      ? "var(--color-text-subtle)"
      : hueVar(harness)
    : FILL[tone];

/** A Task's star, centred on (x, y) in the chart's SVG. */
export const Star = ({
  tone,
  harness,
  x,
  y,
}: {
  readonly tone: StripTone;
  readonly harness: HarnessKind | null;
  readonly x: number;
  readonly y: number;
}) => {
  const g = GLYPH[tone];
  const at = Math.round(x - g.size / 2);
  const top = Math.round(y - g.size / 2);

  return (
    <g transform={`translate(${at} ${top})`} fill={toneFill(tone, harness)} data-star={tone}>
      {g.paths.map((p) => (
        <path key={p.d} d={p.d} opacity={p.opacity} />
      ))}
    </g>
  );
};

/** A glyph on its own, for the legend. */
export const StarIcon = ({
  tone,
  harness = null,
}: {
  readonly tone: StripTone;
  readonly harness?: HarnessKind | null;
}) => {
  const g = GLYPH[tone];

  return (
    <svg
      width={g.size}
      height={g.size}
      viewBox={`0 0 ${g.size} ${g.size}`}
      aria-hidden
      className="shrink-0 [shape-rendering:crispEdges]"
      fill={toneFill(tone, harness)}
    >
      {g.paths.map((p) => (
        <path key={p.d} d={p.d} opacity={p.opacity} />
      ))}
    </svg>
  );
};

/** The gate: the bright star where the lines converge, accepted once it is. */
export const GateStar = ({
  x,
  y,
  accepted,
}: {
  readonly x: number;
  readonly y: number;
  readonly accepted: boolean;
}) => {
  const ink = accepted ? "var(--color-accepted)" : "var(--color-text-strong)";

  return (
    <g data-star={accepted ? "gate-accepted" : "gate"}>
      <circle cx={x} cy={y} r={30} fill="var(--color-text-strong)" opacity={0.03} />
      <circle cx={x} cy={y} r={19} fill="var(--color-text-strong)" opacity={0.04} />
      <circle cx={x} cy={y} r={12} fill="var(--color-well)" />
      <circle cx={x} cy={y} r={7.5} fill="none" stroke={ink} strokeWidth={1.5} />
      <g stroke={ink} opacity={0.85}>
        <line x1={x} y1={y - 15.5} x2={x} y2={y - 10.5} />
        <line x1={x} y1={y + 10.5} x2={x} y2={y + 15.5} />
        <line x1={x - 15.5} y1={y} x2={x - 10.5} y2={y} />
        <line x1={x + 10.5} y1={y} x2={x + 15.5} y2={y} />
      </g>
      <rect x={x - 1.5} y={y - 1.5} width={3} height={3} fill={ink} opacity={accepted ? 1 : 0.45} />
    </g>
  );
};

const SHADE = {
  dark: (hue: string) => `color-mix(in oklab, ${hue} 60%, black)`,
  hue: (hue: string) => hue,
  light: (hue: string) => `color-mix(in oklab, ${hue} 60%, white)`,
  core: (hue: string) => `color-mix(in oklab, ${hue} 20%, white)`,
} as const;

const RAYS: ReadonlyArray<{ readonly d: string; readonly shade: keyof typeof SHADE }> = [
  {
    d: "M7 3h2v1h-2zM4 4h1v1h-1zM11 4h1v1h-1zM3 7h1v2h-1zM12 7h1v2h-1zM4 11h1v1h-1zM11 11h1v1h-1zM7 12h2v1h-2z",
    shade: "dark",
  },
  {
    d: "M7 4h2v2h-2zM5 5h1v1h-1zM10 5h1v1h-1zM4 7h2v2h-2zM10 7h2v2h-2zM5 10h1v1h-1zM7 10h2v2h-2zM10 10h1v1h-1z",
    shade: "hue",
  },
  { d: "M6 6h4v1h-4zM6 7h1v2h-1zM9 7h1v2h-1zM6 9h4v1h-4z", shade: "light" },
  { d: "M7 7h2v2h-2z", shade: "core" },
];

/** The Lead: the rayed star in its Harness's hue (Paper X-H), drawn at `size` px. */
export const LeadStar = ({
  harness,
  size = 24,
  x,
  y,
}: {
  readonly harness: HarnessKind | null;
  readonly size?: number;
  readonly x?: number;
  readonly y?: number;
}) => {
  const hue = harness === null ? "var(--color-text-subtle)" : hueVar(harness);
  const placed = x !== undefined && y !== undefined;

  return (
    <svg
      x={placed ? x - size / 2 : undefined}
      y={placed ? y - size / 2 : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0 [shape-rendering:crispEdges]"
    >
      {RAYS.map((r) => (
        <path key={r.d} d={r.d} fill={SHADE[r.shade](hue)} />
      ))}
    </svg>
  );
};
