/**
 * The Constellation mark and the rail glyphs (DESIGN.md, Rail glyphs): every state keeps a
 * shape, so colour is never alone (rule/no-colour-alone).
 */
import type { HarnessKind } from "@polaris/protocol";
import { cn, Dither, hueVar, PixelFailedIcon, PixelHandIcon } from "@polaris/ui";
import type { TaskGlyphKind } from "../model/index.ts";

const BRIGHT: ReadonlyArray<readonly [number, number]> = [
  [2, 7],
  [3, 6],
  [3, 7],
  [3, 8],
  [4, 7],
  [6, 13],
  [7, 12],
  [7, 13],
  [7, 14],
  [8, 13],
  [9, 3],
  [10, 3],
  [11, 1],
  [11, 2],
  [11, 3],
  [11, 4],
  [11, 5],
  [12, 3],
  [13, 3],
  [14, 11],
];

const DIM: ReadonlyArray<readonly [number, number]> = [
  [5, 10],
  [6, 6],
  [8, 4],
  [10, 12],
  [12, 12],
];

/** Three stars joined by dotted lines, in Starlight: the graph is Polaris's own work. */
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
    focusable="false"
    className={cn("pixelated text-starlight shrink-0", className)}
    fill="currentColor"
  >
    {BRIGHT.map(([x, y]) => (
      <rect key={`b${x}.${y}`} x={x} y={y} width={1} height={1} />
    ))}
    {DIM.map(([x, y]) => (
      <rect key={`d${x}.${y}`} x={x} y={y} width={1} height={1} opacity={0.4} />
    ))}
  </svg>
);

const RING = "box-border rounded-full border-[1.5px]";

const drawGlyph = (glyph: TaskGlyphKind, harness: HarnessKind | null) => {
  switch (glyph) {
    case "working":
      return harness === null ? (
        <span className={cn(RING, "border-text-subtle size-2.5")} />
      ) : (
        <Dither hue={harness} size={10} moving />
      );
    case "review":
    case "review-unfetched":
      return (
        <span
          className={cn(
            RING,
            "border-text-default grid size-2.5 place-items-center",
            glyph === "review-unfetched" && "border-dashed"
          )}
        >
          <span className="bg-text-default size-[3px] rounded-full" />
        </span>
      );
    case "needs-you":
      return <PixelHandIcon size={12} className="text-needs-you" />;
    case "accepted":
      return <span className="bg-accepted size-2 rounded-full" />;
    case "waiting":
      return <span className={cn(RING, "border-text-faint size-2")} />;
    case "future":
      return <span className={cn(RING, "border-text-faint size-2 border-dashed")} />;
    case "gate":
      return <span className="border-text-subtle box-border size-2 rounded-[1px] border-[1.5px]" />;
    case "gate-accepted":
      return <span className="bg-accepted size-2 rounded-[1px]" />;
    case "failed":
      return <PixelFailedIcon size={12} className="text-failed" />;
    case "stopped":
      return <span className="text-text-faint text-caption leading-none">×</span>;
  }
};

const LABEL: Readonly<Record<TaskGlyphKind, string>> = {
  working: "working",
  review: "in review",
  "review-unfetched": "in review, branch not yet fetched",
  "needs-you": "needs you",
  accepted: "done",
  waiting: "waiting",
  future: "future",
  gate: "gate, waiting",
  "gate-accepted": "gate, done",
  failed: "failed",
  stopped: "stopped",
};

export interface TaskGlyphProps {
  readonly glyph: TaskGlyphKind;
  /** Working takes its Harness's dither. */
  readonly harness: HarnessKind | null;
  /** The slot; the glyph sits centred inside it. */
  readonly size?: number;
  readonly className?: string;
}

/** A Task's state glyph, centred in a square slot (16px in rows and the sidebar). */
export const TaskGlyph = ({ glyph, harness, size = 16, className }: TaskGlyphProps) => (
  <span
    role="img"
    aria-label={LABEL[glyph]}
    data-glyph={glyph}
    className={cn("grid shrink-0 place-items-center", className)}
    style={{ width: size, height: size }}
  >
    {drawGlyph(glyph, harness)}
  </span>
);

const FILLED: Partial<Record<TaskGlyphKind, string>> = {
  accepted: "var(--color-accepted)",
  "gate-accepted": "var(--color-accepted)",
  "needs-you": "var(--color-needs-you)",
  failed: "var(--color-failed)",
};

const fillOf = (glyph: TaskGlyphKind, harness: HarnessKind | null) =>
  glyph === "working" && harness !== null ? hueVar(harness) : (FILLED[glyph] ?? null);

/** A Gate input: a small dot in its input's state (a ring in review, the Harness hue working). */
export const InputDot = ({
  glyph,
  harness,
}: {
  readonly glyph: TaskGlyphKind;
  readonly harness: HarnessKind | null;
}) => {
  const fill = fillOf(glyph, harness);
  const review = glyph === "review" || glyph === "review-unfetched";

  return fill === null ? (
    <span
      className={cn(RING, "size-[7px]", review ? "border-text-default" : "border-text-faint")}
    />
  ) : (
    <span className="size-[7px] rounded-full" style={{ background: fill }} />
  );
};
