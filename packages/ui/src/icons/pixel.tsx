import type { SVGProps } from "react";

import { cn } from "../lib/cn";

/**
 * Pixel glyphs for Polaris-owned concepts: Nucleo pixel icons (vendored in ./nucleo under
 * their own licence) and the Polaris star, drawn on a strict grid in currentColor.
 */
export * from "./nucleo/pixel";

export type PixelIconProps = SVGProps<SVGSVGElement> & { readonly size?: number };

import { starCells, type Cell } from "./star";

export { starCells };

function CellPixels({
  size = 16,
  cells,
  className,
  ...props
}: PixelIconProps & { readonly cells: readonly Cell[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={cn("pixelated", className)}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}

const STAR = starCells();

/** The flat Polaris mark, for sizes below 24px. Never rotated, outlined or anti-aliased. */
export function PixelPolarisIcon(props: PixelIconProps) {
  return <CellPixels cells={STAR} {...props} />;
}
