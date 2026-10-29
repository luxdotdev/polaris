/**
 * Home's glyphs: the section marks drawn with Views (Paper H4) and the needs you star (MX-C).
 * Celestials are src/celestial, the Working dither src/dither.
 */
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../../theme";

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
  <Pixels rects={NEEDS_YOU_MARK} size={10} unit={1} color={useTheme().colours.needsYou} />
);

export const WorkingMark = () => (
  <Pixels rects={WORKING_MARK} size={10} unit={1} color={useTheme().colours.textSubtle} />
);

/** The four-point star by the needs you count: the header badge, the hero kicker, the inbox. */
export const NeedsYouStar = ({ size }: { readonly size: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M6 0.5 L7.1 4.9 L11.5 6 L7.1 7.1 L6 11.5 L4.9 7.1 L0.5 6 L4.9 4.9 Z"
      fill={useTheme().colours.needsYou}
    />
  </Svg>
);
