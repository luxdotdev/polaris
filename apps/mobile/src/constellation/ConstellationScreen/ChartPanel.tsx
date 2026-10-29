/**
 * The constellation header (Paper MX-W, compressing to MX-X): a panel above the lead's thread
 * with the done count, the stats chip, the star chart and its legend. Tap only.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { isCompact, StarChart, StarLegend, starCounts } from "../../starChart/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { themedStyles } from "../../theme/index.ts";
import type { StarChartData } from "./stars.ts";

/** The chart's share of the screen; past it (many bands, Dynamic Type) the chart scrolls. */
export const CHART_SHARE = 0.22;

export interface ChartPanelProps {
  readonly chart: StarChartData;
  /** The stats chip's reading, e.g. "1h 12m". */
  readonly stats: string;
  readonly selectedTaskId: string | null;
  readonly onPressTask: (taskId: string) => void;
  readonly onOpenStats: () => void;
  readonly onViewAll: () => void;
}

export const ChartPanel = ({
  chart,
  stats,
  selectedTaskId,
  onPressTask,
  onOpenStats,
  onViewAll,
}: ChartPanelProps) => {
  const styles = useStyles();
  const { done } = starCounts(chart.tasks);
  const compact = isCompact(chart.tasks);
  const { height } = useWindowDimensions();

  return (
    <View style={styles.panel}>
      <View style={styles.top}>
        <Text style={styles.kicker} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          CONSTELLATION
        </Text>
        <Text style={styles.done} maxFontSizeMultiplier={CHROME_TEXT_SCALE} numberOfLines={1}>
          {done} of {chart.tasks.length} done
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stats, ${stats}`}
          hitSlop={8}
          onPress={onOpenStats}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Text style={styles.chipText} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {stats} ›
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ maxHeight: height * CHART_SHARE }}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <StarChart
          tasks={chart.tasks}
          bands={chart.bands}
          compact={compact}
          selectedTaskId={selectedTaskId}
          onPressTask={onPressTask}
        />
      </ScrollView>
      <StarLegend tasks={chart.tasks} compact={compact} onViewAll={onViewAll} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  // Wraps rather than squeezing: a wide chip (a long run's cost) moves under the done count.
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 6 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
  },
  done: {
    ...mobileType.footnote,
    fontSize: 13,
    lineHeight: 18,
    flexGrow: 1,
    color: colours.textDefault,
  },
  chip: {
    flexShrink: 0,
    marginLeft: "auto",
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  chipText: {
    fontFamily: mobileFont.mono,
    fontSize: 12,
    lineHeight: 16,
    color: colours.textDefault,
  },
  pressed: { opacity: 0.7 },
}));
