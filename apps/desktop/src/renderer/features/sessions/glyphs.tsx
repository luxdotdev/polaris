/**
 * Stand-ins for `features/constellation`'s ConstellationMark and TaskGlyph (C1-U1), same
 * names and props, until that slice lands (DESIGN.md, Constellation (DAG) → Rail glyphs).
 */
import type { HarnessKind } from "@polaris/protocol";
import { cn, PixelHandIcon } from "@polaris/ui";
import { SessionGlyph } from "../../shell/glyphs.tsx";

export type TaskGlyphKind =
  | "working"
  | "review"
  | "review-unfetched"
  | "needs-you"
  | "accepted"
  | "waiting"
  | "future"
  | "gate"
  | "gate-accepted"
  | "failed"
  | "stopped";

/** The mark's cells: [x, y, bright]; dim cells are the dotted joins (px-constellation). */
const MARK: ReadonlyArray<readonly [number, number, 0 | 1 | 2]> = [
  [5, 10, 0],
  [6, 6, 0],
  [8, 4, 0],
  [10, 12, 0],
  [12, 12, 0],
  [2, 7, 1],
  [3, 6, 1],
  [3, 7, 2],
  [3, 8, 1],
  [4, 7, 1],
  [6, 13, 1],
  [7, 12, 1],
  [7, 13, 2],
  [7, 14, 1],
  [8, 13, 1],
  [9, 3, 1],
  [10, 3, 1],
  [11, 1, 1],
  [11, 2, 1],
  [11, 3, 2],
  [11, 4, 1],
  [11, 5, 1],
  [12, 3, 1],
  [13, 3, 1],
  [14, 11, 2],
];

const CELL_FILL = [
  "fill-starlight opacity-40",
  "fill-starlight",
  "fill-[light-dark(var(--color-starlight-text),#fff)]",
];

/** The Constellation feature mark: three stars joined by dotted lines, in Starlight. */
export const ConstellationMark = ({
  size = 16,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={cn("shrink-0 [shape-rendering:crispEdges]", className)}
  >
    {MARK.map(([x, y, tone]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" className={CELL_FILL[tone]} />
    ))}
  </svg>
);

const Dot = ({ className, size }: { readonly className: string; readonly size: number }) => (
  <span
    aria-hidden="true"
    className={cn("rounded-full", className)}
    style={{ width: size * 0.5, height: size * 0.5 }}
  />
);

interface TaskGlyphProps {
  readonly glyph: TaskGlyphKind;
  readonly harness: HarnessKind | null;
  readonly size?: number;
}

const Inner = ({ glyph, harness, size }: Required<TaskGlyphProps>) => {
  switch (glyph) {
    case "working":
      return <SessionGlyph state="working" harness={harness ?? "claude"} size={size * 0.75} />;
    case "needs-you":
      return <PixelHandIcon size={size * 0.875} className="text-needs-you" />;
    case "accepted":
      return <Dot size={size} className="bg-accepted" />;
    case "review":
    case "review-unfetched":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "border-text-default flex items-center justify-center rounded-full border-[1.5px]",
            glyph === "review-unfetched" && "border-dashed"
          )}
          style={{ width: size * 0.625, height: size * 0.625 }}
        >
          <span className="bg-text-default size-[3px] rounded-full" />
        </span>
      );
    case "gate":
    case "gate-accepted":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "rounded-[1px] border-[1.5px]",
            glyph === "gate" ? "border-text-subtle" : "border-accepted bg-accepted"
          )}
          style={{ width: size * 0.5, height: size * 0.5 }}
        />
      );
    case "failed":
    case "stopped":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "text-micro leading-none font-medium",
            glyph === "failed" ? "text-failed-text" : "text-text-faint"
          )}
        >
          ×
        </span>
      );
    default:
      return (
        <Dot
          size={size}
          className={cn("border-text-faint border-[1.5px]", glyph === "future" && "border-dashed")}
        />
      );
  }
};

export const TaskGlyph = ({ glyph, harness, size = 16 }: TaskGlyphProps) => (
  <span
    data-glyph={glyph}
    className="flex shrink-0 items-center justify-center"
    style={{ width: size, height: size }}
  >
    <Inner glyph={glyph} harness={harness} size={size} />
  </span>
);
