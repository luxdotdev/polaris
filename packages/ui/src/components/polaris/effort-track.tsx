import {
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { hueVar, type TintHue } from "../../lib/hue";

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const CELL = 2;

/** The field's rows: 12px of cells under a 2px gap, inside the 16px track with the thumb. */
const FIELD_TOP = 2;

const FIELD_ROWS = 6;

const TRACK_HEIGHT = 16;

const THUMB = 3;

/** Before the first measure (and in tests without layout). */
const FALLBACK_WIDTH = 316;

/** How full the field is at `t` along the track: sparse at the left end, full at the right. */
export const effortDensity = (t: number) => 0.1 + 0.9 * Math.min(1, Math.max(0, t));

/** The 2px cells lit across a track `width` wide, left to right, by a Bayer threshold. */
export function effortCells(width: number): ReadonlyArray<{ x: number; y: number }> {
  const columns = Math.floor(width / CELL);
  const cells: Array<{ x: number; y: number }> = [];

  for (let c = 0; c < columns; c++) {
    const density = effortDensity(columns <= 1 ? 1 : c / (columns - 1));

    for (let r = 0; r < FIELD_ROWS; r++) {
      const threshold = ((BAYER4[r % 4]?.[c % 4] ?? 0) + 0.5) / 16;

      if (threshold < density) cells.push({ x: c * CELL, y: FIELD_TOP + r * CELL });
    }
  }

  return cells;
}

/** The thumb's left edge for level `index` of `count`, on the cell grid. */
export const effortThumbX = (index: number, count: number, width: number) => {
  const t = count <= 1 ? 1 : index / (count - 1);

  return Math.floor((t * (width - THUMB)) / CELL) * CELL;
};

/** The level nearest `x` (from the track's left edge); past either end holds at it. */
export const effortNearest = (x: number, count: number, width: number) =>
  Math.min(count - 1, Math.max(0, Math.round((x / Math.max(1, width)) * (count - 1))));

const MOVES = new Map<string, (value: number, count: number) => number>([
  ["ArrowRight", (value) => value + 1],
  ["ArrowUp", (value) => value + 1],
  ["ArrowLeft", (value) => value - 1],
  ["ArrowDown", (value) => value - 1],
  ["Home", () => 0],
  ["End", (_, count) => count - 1],
]);

/** The level a key moves to: arrows step, Home/End jump; null for any other key or no move. */
export const effortKey = (key: string, value: number, count: number): number | null => {
  const move = MOVES.get(key);

  if (move === undefined) return null;
  const clamped = Math.min(count - 1, Math.max(0, move(value, count)));

  return clamped === value ? null : clamped;
};

const trackVars = (hue: TintHue): CssVars => ({ "--track-hue": hueVar(hue) });

const toPath = (cells: ReadonlyArray<{ x: number; y: number }>) =>
  cells.map((c) => `M${c.x} ${c.y}h${CELL}v${CELL}h-${CELL}z`).join("");

/** The track's width, followed as its container resizes. */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const node = ref.current;

    if (node === null || typeof ResizeObserver === "undefined") return undefined;

    const measure = () => {
      const next = Math.floor(node.clientWidth / CELL) * CELL;

      if (next > 0) setWidth(next);
    };

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
};

export interface EffortTrackProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  readonly levels: readonly string[];
  readonly value: number;
  readonly hue: TintHue;
  /** A key, a press or a drag moved it to another level. */
  readonly onChange?: (index: number) => void;
}

/**
 * DESIGN.md, Menus and popovers: effort as a track the card's full width whose dither field
 * thickens from sparse at the lowest level to full at the highest, lit in the Harness hue up to
 * the thumb. Still: nothing here loops. Arrows step, Home/End jump, a press or drag picks.
 */
export function EffortTrack({
  levels,
  value,
  hue,
  onChange,
  className,
  onKeyDown,
  ...props
}: EffortTrackProps) {
  const count = levels.length;
  const { ref, width } = useWidth();
  const thumb = effortThumbX(value, count, width);

  const [lit, unlit] = useMemo(() => {
    const cells = effortCells(width);

    return [toPath(cells.filter((c) => c.x < thumb)), toPath(cells.filter((c) => c.x >= thumb))];
  }, [width, thumb]);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const level = effortNearest(event.clientX - left, count, width);

    if (level !== value) onChange?.(level);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    const next = effortKey(event.key, value, count);

    if (next === null || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onChange?.(next);
  };

  return (
    <div
      data-slot="effort-track"
      className={cn("flex w-full flex-col gap-1.5", className)}
      style={trackVars(hue)}
      {...props}
    >
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Effort"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={value}
        aria-valuetext={levels[value]}
        className="focus-visible:outline-starlight w-full cursor-default touch-none rounded-[2px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        onKeyDown={key}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          // Captured, so a drag keeps picking past the ends and the release lands here.
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
        }}
      >
        <svg
          width={width}
          height={TRACK_HEIGHT}
          viewBox={`0 0 ${width} ${TRACK_HEIGHT}`}
          aria-hidden
          className="block [shape-rendering:crispEdges]"
        >
          <path d={unlit} className="fill-text-faint opacity-40" data-part="unlit" />
          <path d={lit} fill="var(--track-hue)" data-part="lit" />
          <rect
            x={thumb}
            y={0}
            width={THUMB}
            height={TRACK_HEIGHT}
            className="fill-text-strong"
            data-part="thumb"
          />
        </svg>
      </div>
      <div className="relative h-3" aria-hidden>
        {levels.map((level, i) => (
          <span
            key={level}
            className={cn(
              "absolute top-0 font-mono text-[10px] leading-3 whitespace-nowrap",
              i === value ? "text-text-strong" : "text-text-subtle"
            )}
            style={labelPosition(i, count, width)}
          >
            {level}
          </span>
        ))}
      </div>
    </div>
  );
}

/** First and last labels sit flush with the ends; the rest centre on their level. */
const labelPosition = (i: number, count: number, width: number) => {
  if (i === 0) return { left: 0 };

  if (i === count - 1) return { right: 0 };

  return { left: effortThumbX(i, count, width) + 1, transform: "translateX(-50%)" };
};
