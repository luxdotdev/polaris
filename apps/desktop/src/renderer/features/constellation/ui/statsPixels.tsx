/**
 * The Stats popover's pixel marks (ENG-470): cell bars, ruler ticks and cell columns, drawn
 * crisp in one SVG each, with dither densities for lighter states, lit left to right once on open.
 */
import { cn } from "@polaris/ui";
import { type CSSProperties, useId } from "react";

/** Empty cells, as Settings → Usage's meters. */
export const TRACK = "light-dark(#0000000f, #ffffff12)";

/** Solid, a 1px checkerboard, or one pixel in four: lighter states without a new colour. */
export type Density = "solid" | "half" | "sparse";

export interface CellPart {
  readonly key: string;
  readonly share: number;
  readonly fill: string;
  readonly density?: Density;
}

const CELL = 2;

const PITCH = CELL + 1;

/** Sweep across the whole mark in at most this long, so it never drags. */
const SWEEP_MS = 220;

const delay = (i: number, n: number): CSSProperties =>
  // SAFETY: a custom property is a valid style key; React passes it through unchanged.
  ({ "--cell-delay": `${Math.round((i / Math.max(1, n)) * SWEEP_MS)}ms` }) as CSSProperties;

/** Cells per part by largest remainder; any part with a share keeps at least one cell. */
export const allocate = (shares: ReadonlyArray<number>, cells: number): ReadonlyArray<number> => {
  const total = shares.reduce((a, b) => a + b, 0);

  if (total <= 0) return shares.map(() => 0);

  const raw = shares.map((s) => (s / total) * cells);
  const out = raw.map((r, i) => ((shares[i] ?? 0) > 0 ? Math.max(1, Math.floor(r)) : 0));

  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .toSorted((a, b) => b.rest - a.rest);

  let left = cells - out.reduce((a, b) => a + b, 0);

  for (const { i } of order) {
    if (left <= 0) break;

    if ((shares[i] ?? 0) > 0) {
      out[i] = (out[i] ?? 0) + 1;
      left -= 1;
    }
  }

  while (left < 0) {
    const most = out.indexOf(Math.max(...out));

    out[most] = (out[most] ?? 0) - 1;
    left += 1;
  }

  return out;
};

/** One `<pattern>` per fill and density; solid fills skip it. */
const Patterns = ({
  id,
  fills,
}: {
  readonly id: string;
  readonly fills: ReadonlyArray<{ readonly fill: string; readonly density: Density }>;
}) => (
  <defs>
    {fills.map(({ fill, density }, i) =>
      density === "solid" ? null : (
        <pattern
          key={`${fill}-${density}`}
          id={`${id}-${i}`}
          width={2}
          height={2}
          patternUnits="userSpaceOnUse"
        >
          <rect width={1} height={1} style={{ fill }} />
          {density === "half" ? <rect x={1} y={1} width={1} height={1} style={{ fill }} /> : null}
        </pattern>
      )
    )}
  </defs>
);

const usePaint = (parts: ReadonlyArray<{ readonly fill: string; readonly density?: Density }>) => {
  const id = useId().replaceAll(":", "");

  const fills = parts.map((p) => ({ fill: p.fill, density: p.density ?? "solid" }));

  const paint = (i: number) => {
    const f = fills[i];

    return f === undefined || f.density === "solid" ? f?.fill : `url(#${id}-${i})`;
  };

  return { defs: <Patterns id={id} fills={fills} />, paint };
};

/**
 * A whole as 2px cells split by share. `active` dims every other part to 35% (a hovered
 * legend row), as the context card's breakdown does.
 */
export const CellBar = ({
  parts,
  width,
  height = 10,
  active = null,
  label,
}: {
  readonly parts: ReadonlyArray<CellPart>;
  readonly width: number;
  readonly height?: number;
  readonly active?: string | null;
  readonly label: string;
}) => {
  const cells = Math.floor((width + 1) / PITCH);

  const counts = allocate(
    parts.map((p) => p.share),
    cells
  );

  const { defs, paint } = usePaint(parts);
  let at = 0;

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pixelated block [shape-rendering:crispEdges]"
      data-testid="stats-bar"
    >
      {defs}
      {Array.from({ length: cells }, (_, i) => (
        <rect
          key={`track-${String(i)}`}
          x={i * PITCH}
          width={CELL}
          height={height}
          style={{ fill: TRACK }}
        />
      ))}
      {parts.map((p, pi) => {
        const from = at;

        at += counts[pi] ?? 0;

        return (
          <g
            key={p.key}
            className="transition-opacity duration-[120ms]"
            style={{ opacity: active === null || active === p.key ? 1 : 0.35 }}
            data-part={p.key}
          >
            {Array.from({ length: counts[pi] ?? 0 }, (_, k) => (
              <rect
                key={`${p.key}-${String(k)}`}
                x={(from + k) * PITCH}
                width={CELL}
                height={height}
                className="polaris-stats-cell"
                style={{ fill: paint(pi), ...delay(from + k, cells) }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
};

const TICK_PITCH = 4;

/**
 * A ruler of ticks, every fifth taller, lit to `share`; the last lit tick is the marker in
 * `text-strong`, a pixel taller each way, like the plan-limit meter's pace cell.
 */
export const TickRuler = ({
  share,
  fill,
  width,
  dim = false,
}: {
  readonly share: number;
  readonly fill: string;
  readonly width: number;
  readonly dim?: boolean;
}) => {
  const ticks = Math.floor((width + TICK_PITCH - CELL) / TICK_PITCH);
  const lit = share > 0 ? Math.max(1, Math.round(share * ticks)) : 0;

  return (
    <svg
      aria-hidden
      width={width}
      height={14}
      viewBox={`0 0 ${width} 14`}
      className={cn(
        "pixelated block [shape-rendering:crispEdges] shrink-0 transition-opacity duration-[120ms]",
        dim && "opacity-35"
      )}
    >
      {Array.from({ length: ticks }, (_, i) => {
        const marker = i === lit - 1;
        const tall = i % 5 === 0 ? 10 : 6;
        const h = marker ? 14 : tall;

        return (
          <rect
            key={`tick-${String(i)}`}
            x={i * TICK_PITCH}
            y={marker ? 0 : 12 - h}
            width={CELL}
            height={h}
            className={i < lit ? "polaris-stats-cell" : undefined}
            style={{
              fill: marker ? "var(--color-text-strong)" : i < lit ? fill : TRACK,
              ...delay(i, ticks),
            }}
          />
        );
      })}
    </svg>
  );
};

export interface Column {
  readonly id: string;
  /** Of the tallest, 0–1. */
  readonly height: number;
}

/** Columns of stacked 2px cells; the active one solid, the rest at half density. */
export const CellColumns = ({
  columns,
  active,
  fill,
  width,
  height = 48,
  onActive,
}: {
  readonly columns: ReadonlyArray<Column>;
  readonly active: number;
  readonly fill: string;
  readonly width: number;
  readonly height?: number;
  readonly onActive: (index: number) => void;
}) => {
  const n = Math.max(1, columns.length);
  const gap = n > 30 ? 1 : 3;
  const col = Math.max(1, Math.min(32, Math.floor((width - gap * (n - 1)) / n)));
  const rows = Math.floor((height + 1) / PITCH);

  const { defs, paint } = usePaint([
    { fill, density: "solid" },
    { fill, density: "half" },
  ]);

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pixelated block [shape-rendering:crispEdges]"
    >
      {defs}
      {columns.map((c, i) => {
        const x = i * (col + gap);
        const lit = c.height > 0 ? Math.max(1, Math.round(c.height * rows)) : 0;

        return (
          <g key={c.id} onPointerEnter={() => onActive(i)}>
            <rect x={x} width={col + gap} height={height} fill="transparent" />
            {Array.from({ length: lit }, (_, r) => (
              <rect
                key={`${c.id}-${String(r)}`}
                x={x}
                y={height - (r + 1) * PITCH + 1}
                width={col}
                height={CELL}
                className="polaris-stats-cell"
                style={{ fill: paint(i === active ? 0 : 1), ...delay(i, n) }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
};
