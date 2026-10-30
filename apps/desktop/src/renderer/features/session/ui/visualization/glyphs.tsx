/** The Visualization's own pixel glyphs (DESIGN.md, Visualizations), on a 16-cell grid in currentColor. */
import { cn } from "@polaris/ui";

type Cell = readonly [x: number, y: number, w: number, h: number];

const Cells = ({
  size,
  cells,
  className,
}: {
  readonly size: number;
  readonly cells: ReadonlyArray<Cell>;
  readonly className?: string | undefined;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden
    focusable="false"
    className={cn("pixelated shrink-0", className)}
  >
    {cells.map(([x, y, w, h]) => (
      <rect key={`${x}.${y}`} x={x} y={y} width={w} height={h} />
    ))}
  </svg>
);

/** Three bars, rising: a Visualization's title line. */
export const BarsGlyph = ({ size = 14, className }: { size?: number; className?: string }) => (
  <Cells
    size={size}
    className={className}
    cells={[
      [2, 9, 3, 5],
      [6.5, 5, 3, 9],
      [11, 2, 3, 12],
    ]}
  />
);

/** A square in a ring: the frame was stopped. */
export const StopGlyph = ({ size = 16, className }: { size?: number; className?: string }) => (
  <Cells
    size={size}
    className={className}
    cells={[
      [4, 1, 8, 2],
      [4, 13, 8, 2],
      [1, 4, 2, 8],
      [13, 4, 2, 8],
      [3, 3, 1, 1],
      [12, 3, 1, 1],
      [3, 12, 1, 1],
      [12, 12, 1, 1],
      [6, 6, 4, 4],
    ]}
  />
);

/** Two corners pointing out: Expand. */
export const ExpandGlyph = ({ size = 12, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    aria-hidden
    focusable="false"
    className={cn("shrink-0", className)}
  >
    <path d="M7 1.5h3.5V5M10.5 1.5 6.75 5.25M5 10.5H1.5V7M1.5 10.5l3.75-3.75" />
  </svg>
);
