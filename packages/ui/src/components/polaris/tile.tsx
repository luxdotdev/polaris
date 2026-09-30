import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { hueVar, resolveTint, washVar, type TintHue } from "../../lib/hue";

/** 24, 32 and 40 are the DESIGN.md sizes; 20 and 28 are the Compact and Calm session-row tiles. */
export type TileSize = 20 | 24 | 28 | 32 | 40 | 48;

/** The row radius at 32 and 40; Paper scales it below (a round tile would read as a dot) and above. */
const RADII: Record<TileSize, string> = {
  20: "rounded-control",
  24: "rounded-[7px]",
  28: "rounded-[8px]",
  32: "rounded-row",
  40: "rounded-row",
  48: "rounded-[12px]",
};

export interface TileProps extends HTMLAttributes<HTMLSpanElement> {
  /** The identity hue of the wash; "neutral" is an unwashed tile (a pull request, say). */
  readonly hue: TintHue;
  readonly size?: TileSize;
  /** Dormant tiles drop the wash and take a dashed hairline. */
  readonly dormant?: boolean;
  /** A dimmed wash, as on an Idle session row. */
  readonly muted?: boolean;
  /** No hue hairline, as on the pane empty-state tile. */
  readonly borderless?: boolean;
}

/**
 * A pixel icon over a watercolour wash (DESIGN.md, Pixel tiles). For identities and
 * Polaris-owned concepts only: Harnesses, Agent Sessions, toast sources.
 */
export function Tile({
  hue: requested,
  size = 32,
  dormant = false,
  muted = false,
  borderless = false,
  className,
  style,
  children,
  ...props
}: TileProps) {
  const hue = resolveTint(requested);
  const washed = hue !== "neutral" && !dormant;

  const vars: CssVars = {
    width: size,
    height: size,
    "--tile-hue": hue === "neutral" ? undefined : hueVar(hue),
    backgroundImage: washed ? washVar(hue) : undefined,
    ...style,
  };

  return (
    <span
      data-slot="tile"
      data-hue={hue}
      className={cn(
        "pixelated relative inline-flex shrink-0 items-center justify-center overflow-clip border bg-cover bg-center bg-origin-border",
        RADII[size],
        washed && "border-[color-mix(in_oklab,var(--tile-hue)_20%,transparent)]",
        hue === "neutral" && !dormant && "border-hairline bg-fill-selected",
        dormant && "border-dashed border-text-faint/40",
        muted && "opacity-70",
        borderless && "border-transparent",
        className
      )}
      style={vars}
      {...props}
    >
      {children}
    </span>
  );
}
