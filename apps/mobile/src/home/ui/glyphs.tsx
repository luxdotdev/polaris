/**
 * Home's pixel glyphs drawn with Views (no SVG on React Native here): the needs you hand, the
 * Working dither, section marks and the constellation mark, from Paper H4's vectors.
 */
import { midnight } from "@polaris/ui/tokens";
import { memo } from "react";
import { View } from "react-native";
import { ditherFrame } from "./dither.ts";
import { useDitherFrame, useReduceMotion } from "./motion.ts";

type Rect = readonly [x: number, y: number, width: number, height: number, alpha?: number];

const Pixels = ({
  rects,
  size,
  unit,
  color,
}: {
  readonly rects: ReadonlyArray<Rect>;
  readonly size: number;
  readonly unit: number;
  readonly color: string;
}) => (
  <View style={{ width: size, height: size }}>
    {rects.map(([x, y, width, height, alpha = 1]) => (
      <View
        key={`${x}:${y}:${width}:${height}`}
        style={{
          position: "absolute",
          left: x * unit,
          top: y * unit,
          width: width * unit,
          height: height * unit,
          backgroundColor: color,
          opacity: alpha,
        }}
      />
    ))}
  </View>
);

/** A 2-wide square-capped stroke from (x1, y1) to (x2, y2), axis-aligned, in a 24 grid. */
const stroke = (x1: number, y1: number, x2: number, y2: number): Rect => [
  Math.min(x1, x2) - 1,
  Math.min(y1, y2) - 1,
  Math.abs(x2 - x1) + 2,
  Math.abs(y2 - y1) + 2,
];

const HAND: ReadonlyArray<Rect> = [
  stroke(19, 21, 19, 7),
  stroke(16, 10, 16, 5),
  stroke(16, 5, 17, 5),
  stroke(13, 10, 13, 3),
  stroke(13, 3, 14, 3),
  stroke(10, 10, 10, 1),
  stroke(10, 1, 11, 1),
  stroke(7, 12, 7, 3),
  stroke(7, 3, 10, 3),
  stroke(4, 10, 4, 16),
  stroke(6, 18, 6, 18),
  stroke(8, 20, 8, 21),
];

/** The raised hand on a needs you tile. */
export const NeedsYouGlyph = () => (
  <Pixels rects={HAND} size={18} unit={18 / 24} color={midnight.needsYou} />
);

/** The Working dither in the Harness's hue; still under Reduce Motion or when `still`. */
export const WorkingDither = memo(function WorkingDither({
  color,
  size = 20,
  still = false,
}: {
  readonly color: string;
  readonly size?: number;
  readonly still?: boolean;
}) {
  const reduce = useReduceMotion();
  const frame = useDitherFrame(still || reduce);
  const cells = ditherFrame(size, frame);

  return (
    <Pixels
      rects={cells.map((cell) => [cell.x, cell.y, 2, 2, cell.alpha] as const)}
      size={size}
      unit={1}
      color={color}
    />
  );
});

const NEEDS_YOU_MARK: ReadonlyArray<Rect> = [
  [4, 0, 2, 10, 0.7],
  [0, 4, 10, 2, 0.7],
  [3, 3, 4, 4],
];

const WORKING_MARK: ReadonlyArray<Rect> = [
  [4, 4, 2, 2],
  [0, 0, 1, 1, 0.5],
  [2, 2, 1, 1, 0.6],
  [8, 0, 1, 1, 0.5],
  [7, 2, 1, 1, 0.6],
  [0, 8, 1, 1, 0.5],
  [2, 7, 1, 1, 0.6],
  [8, 8, 1, 1, 0.5],
  [7, 7, 1, 1, 0.6],
];

export const NeedsYouMark = () => (
  <Pixels rects={NEEDS_YOU_MARK} size={10} unit={1} color={midnight.needsYou} />
);

export const WorkingMark = () => (
  <Pixels rects={WORKING_MARK} size={10} unit={1} color={midnight.starlight} />
);

const Line = ({
  from,
  to,
}: {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);

  return (
    <View
      style={{
        position: "absolute",
        left: (from[0] + to[0]) / 2 - length / 2,
        top: (from[1] + to[1]) / 2 - 0.5,
        width: length,
        height: 1,
        backgroundColor: midnight.starlight,
        opacity: 0.35,
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
};

/** The constellation mark: three stars, the third dim, joined by faint lines. */
export const ConstellationGlyph = () => (
  <View style={{ width: 20, height: 20 }}>
    <Line from={[4.5, 13.5]} to={[10.5, 6.5]} />
    <Line from={[10.5, 6.5]} to={[15.5, 14.5]} />
    <Pixels
      rects={[
        [3, 12, 3, 3],
        [9, 5, 3, 3],
        [14, 13, 3, 3, 0.45],
      ]}
      size={20}
      unit={1}
      color={midnight.starlight}
    />
  </View>
);
