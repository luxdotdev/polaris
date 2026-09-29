import type { HTMLAttributes } from "react";

import { cn } from "../../../lib/cn";
import type { CssVars } from "../../../lib/css";
import { hueVar, type TintHue } from "../../../lib/hue";
import { DITHER_FRAMES, ditherStillMask, ditherStripMask } from "./frames";

export { DITHER_CELL, DITHER_FRAME_MS, DITHER_FRAMES, ditherFrame } from "./frames";

export interface DitherProps extends HTMLAttributes<HTMLSpanElement> {
  /** The hue it shimmers in: the Harness's, or Starlight for Polaris's own work. */
  readonly hue: TintHue;
  /** Square size in px, or use width and height for a band. Multiples of the 2px cell. */
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * Only a Working Agent Session moves (rule/only-working-moves). A still field is the
   * Starting pattern; Reduce Motion stills a moving one.
   */
  readonly moving?: boolean;
  /** Starting renders the still pattern at 50%. */
  readonly dim?: boolean;
}

/** The signature dither: a field of 2px cells on a strict grid, stepped on the compositor. */
export function Dither({
  hue,
  size = 16,
  width = size,
  height = size,
  moving = false,
  dim = false,
  className,
  style,
  ...props
}: DitherProps) {
  const field = { width, height };

  const vars: CssVars = {
    "--dither-hue": hueVar(hue),
    "--dither-frames": DITHER_FRAMES,
    "--dither-still": ditherStillMask(field),
    "--dither-strip": moving ? ditherStripMask(field) : undefined,
    width,
    height,
    opacity: dim ? 0.5 : undefined,
    ...style,
  };

  return (
    <span
      aria-hidden="true"
      data-moving={moving ? "" : undefined}
      className={cn("polaris-dither", className)}
      style={vars}
      {...props}
    >
      <span />
    </span>
  );
}
