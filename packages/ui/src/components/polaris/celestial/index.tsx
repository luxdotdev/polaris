import type { CelestialBody } from "@polaris/protocol";
import type { HTMLAttributes } from "react";

import { cn } from "../../../lib/cn";
import type { CssVars } from "../../../lib/css";
import { hueVar, type Harness } from "../../../lib/hue";
import {
  CELESTIAL_FRAME_MS,
  CELESTIAL_FRAMES,
  CELESTIAL_GRID,
  type Cell,
  celestialCells,
  type Tone,
} from "./bodies";

export {
  CELESTIAL_FRAME_MS,
  CELESTIAL_FRAMES,
  celestialCells,
  isKnownCelestial,
  leadStar,
  sessionCelestial,
  subagentMoon,
} from "./bodies";

export type CelestialSize = 16 | 24 | 32;

export interface CelestialProps extends HTMLAttributes<HTMLSpanElement> {
  readonly body: CelestialBody;
  /** Drawn in its Harness's hue; an unknown Harness is neutral. */
  readonly harness: Harness;
  readonly size: CelestialSize;
  /** Animates inside the body at 12 fps; Reduce Motion keeps it still. */
  readonly working?: boolean;
  readonly dormant?: boolean;
}

const TONES: readonly Tone[] = ["light", "hue", "shade", "glint"];

/** One path per tone, every cell a 1×1 square, offset by whole grid widths for a strip. */
function paths(frames: ReadonlyArray<readonly Cell[]>) {
  const d: Record<Tone, string> = { light: "", hue: "", shade: "", glint: "" };

  frames.forEach((cells, frame) => {
    const offset = frame * CELESTIAL_GRID;

    for (const cell of cells) d[cell.tone] += `M${cell.x + offset} ${cell.y}h1v1h-1z`;
  });

  return TONES.flatMap((tone) =>
    d[tone] === "" ? [] : [<path key={tone} d={d[tone]} className={`polaris-celestial-${tone}`} />]
  );
}

const stripCache = new Map<CelestialBody, readonly (readonly Cell[])[]>();

function strip(body: CelestialBody) {
  let frames = stripCache.get(body);

  if (frames === undefined) {
    frames = Array.from({ length: CELESTIAL_FRAMES }, (_, frame) => celestialCells(body, frame));
    stripCache.set(body, frames);
  }

  return frames;
}

/**
 * An Agent Session's Celestial (DESIGN.md, Celestials): a pixel body on a 16 grid in tones of
 * its Harness hue. Working steps a sprite strip on the compositor; it never adds a halo.
 */
export function Celestial({
  body,
  harness,
  size,
  working = false,
  dormant = false,
  className,
  style,
  ...props
}: CelestialProps) {
  const vars: CssVars = {
    "--celestial-hue": hueVar(harness),
    "--celestial-frames": CELESTIAL_FRAMES,
    "--celestial-frame-ms": `${CELESTIAL_FRAME_MS}ms`,
    width: size,
    height: size,
    ...style,
  };

  return (
    <span
      data-slot="celestial"
      data-body={body}
      data-working={working ? "" : undefined}
      data-dormant={dormant ? "" : undefined}
      aria-hidden={props["aria-label"] === undefined ? true : undefined}
      role={props["aria-label"] === undefined ? undefined : "img"}
      className={cn("polaris-celestial", className)}
      style={vars}
      {...props}
    >
      <svg
        className="polaris-celestial-still"
        width={size}
        height={size}
        viewBox={`0 0 ${CELESTIAL_GRID} ${CELESTIAL_GRID}`}
      >
        {paths([celestialCells(body)])}
      </svg>
      {working ? (
        <span className="polaris-celestial-live">
          <svg
            width={size * CELESTIAL_FRAMES}
            height={size}
            viewBox={`0 0 ${CELESTIAL_GRID * CELESTIAL_FRAMES} ${CELESTIAL_GRID}`}
          >
            {paths(strip(body))}
          </svg>
        </span>
      ) : null}
    </span>
  );
}
