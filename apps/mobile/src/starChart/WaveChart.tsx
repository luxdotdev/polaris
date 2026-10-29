/** MX-W: band badges down the left, a column per wave, edges from upstream; tap a star for its task. */
import { mobileFont } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { G, Line } from "react-native-svg";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import { SelectionRing, StarBody, starRadius, WorkingField } from "./glyph.tsx";
import { chartLayout, GEOMETRY, type PlacedStar } from "./layout.ts";
import type { StarBand, StarTask } from "./types.ts";

/** Each star's tap target, centred on it: wave columns sit at least 36pt apart, stacks 20pt. */
const TARGET = { width: 32, height: 20 } as const;

/** Edges are white at 18% (Paper MX-W's #FFFFFF2E). */
const EDGE_OPACITY = 0.18;

const upstreamOf = (task: StarTask): ReadonlyArray<string> => task.dependsOn ?? [];

interface Props {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly bands: ReadonlyArray<StarBand>;
  readonly width: number;
  readonly selectedTaskId: string | null;
  readonly onPressTask: ((taskId: string) => void) | undefined;
}

export const WaveChart = ({ tasks, bands, width, selectedTaskId, onPressTask }: Props) => {
  const { colours } = useTheme();
  const styles = useStyles();
  const layout = useMemo(() => chartLayout(tasks, bands, width, upstreamOf), [tasks, bands, width]);
  const working = layout.stars.filter((star) => star.task.state === "working");

  return (
    <View style={{ width, height: layout.height }}>
      <Svg width={width} height={layout.height} style={styles.layer}>
        <G stroke={colours.textDefault} strokeOpacity={EDGE_OPACITY} strokeWidth={1}>
          {layout.edges.map(([from, to]) => (
            <Line
              key={`${from.task.id}>${to.task.id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          ))}
        </G>
        {layout.stars.map((star) => (
          <G key={star.task.id}>
            <StarBody {...at(star)} state={star.task.state} colours={colours} />
            {star.task.id === selectedTaskId ? (
              <SelectionRing {...at(star)} colours={colours} />
            ) : null}
          </G>
        ))}
      </Svg>
      {working.map((star) => (
        <View
          key={star.task.id}
          style={[styles.layer, { left: star.x - 5, top: star.y - 5, pointerEvents: "none" }]}
        >
          <WorkingField size={10} colours={colours} />
        </View>
      ))}
      {layout.badges.map((badge) => (
        <View key={`${badge.band.id}@${badge.y}`} style={[styles.badge, { top: badge.y }]}>
          <Text style={styles.letter} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {badge.band.letter}
          </Text>
        </View>
      ))}
      {layout.stars.map((star) => (
        <Pressable
          key={star.task.id}
          accessibilityRole="button"
          accessibilityLabel={`${star.task.label}, ${star.task.state}`}
          accessibilityState={{ selected: star.task.id === selectedTaskId }}
          disabled={onPressTask === undefined}
          onPress={() => onPressTask?.(star.task.id)}
          style={[
            styles.layer,
            {
              left: star.x - TARGET.width / 2,
              top: star.y - TARGET.height / 2,
              width: TARGET.width,
              height: TARGET.height,
            },
          ]}
        />
      ))}
    </View>
  );
};

const at = (star: PlacedStar) => ({ x: star.x, y: star.y, r: starRadius(star.task.state) });

const useStyles = themedStyles((colours) => ({
  layer: { position: "absolute", left: 0, top: 0 },
  badge: {
    position: "absolute",
    left: 0,
    width: GEOMETRY.badge,
    height: GEOMETRY.badge,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  letter: { fontFamily: mobileFont.mono, fontSize: 10, lineHeight: 12, color: colours.textSubtle },
}));
