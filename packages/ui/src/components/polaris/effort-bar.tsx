import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import type { TintHue } from "../../lib/hue";
import { Dither } from "./dither";

export interface EffortStep {
  /** How dense and bright a lit segment is (0–1). */
  readonly intensity: number;
  /** Milliseconds per dither frame, or null when the field holds still. */
  readonly frameMs: number | null;
}

/**
 * The bar's look at effort `index` of `count`: the lowest level is still and sparse, and each
 * step up is denser and steps faster, to 70ms a frame at the top.
 */
export const effortStep = (index: number, count: number): EffortStep => {
  const t = count <= 1 ? 1 : Math.min(1, Math.max(0, index / (count - 1)));

  return { intensity: 0.15 + 0.85 * t, frameMs: t < 0.2 ? null : Math.round(260 - 190 * t) };
};

const MOVES = new Map<string, (value: number, count: number) => number>([
  ["ArrowRight", (value) => value + 1],
  ["ArrowLeft", (value) => value - 1],
  ["Home", () => 0],
  ["End", (_, count) => count - 1],
]);

/** The level a key moves to: ←/→ step, Home/End jump; null for any other key or no move. */
export const effortKey = (key: string, value: number, count: number): number | null => {
  const move = MOVES.get(key);

  if (move === undefined) return null;
  const next = move(value, count);
  const clamped = Math.min(count - 1, Math.max(0, next));

  return clamped === value ? null : clamped;
};

const WIDTH = 224;

const HEIGHT = 10;

const GAP = 2;

/** Segment width on the 2px cell grid. */
export const segmentWidth = (count: number) =>
  Math.floor((WIDTH - GAP * (count - 1)) / Math.max(1, count) / 2) * 2;

export interface EffortBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  readonly levels: readonly string[];
  readonly value: number;
  readonly hue: TintHue;
  /** A segment was clicked. */
  readonly onChange?: (index: number) => void;
}

/**
 * DESIGN.md, Harness picker: effort as a row of dither segments in the Harness hue, lit up to
 * the level. Each lit segment is denser than the one before, and the field steps faster as the
 * level rises (still at the lowest). Reduce Motion stills it like any dither.
 */
export function EffortBar({ levels, value, hue, onChange, className, ...props }: EffortBarProps) {
  const count = levels.length;
  const width = segmentWidth(count);
  const pace = effortStep(value, count);

  return (
    <div data-slot="effort-bar" className={cn("flex items-center gap-0.5", className)} {...props}>
      {levels.map((level, i) => (
        <span
          key={level}
          data-lit={i <= value ? "" : undefined}
          data-testid={`effort-${level}`}
          className="bg-hairline flex shrink-0"
          style={{ width, height: HEIGHT }}
          onPointerDown={(event) => {
            event.preventDefault();
            onChange?.(i);
          }}
        >
          {i > value ? null : (
            <Dither
              hue={hue}
              width={width}
              height={HEIGHT}
              intensity={effortStep(i, count).intensity}
              moving={pace.frameMs !== null}
              frameMs={pace.frameMs ?? undefined}
            />
          )}
        </span>
      ))}
    </div>
  );
}
