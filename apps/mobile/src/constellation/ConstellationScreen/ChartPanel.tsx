/**
 * The constellation header (Paper MX-W, compressing to MX-X): a panel above the lead's thread
 * with the done count, the stats chip, the star chart and its legend. Tap only.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { StarChart } from "../../starChart/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { type StarChartData, type StarCounts, starCounts } from "./stars.ts";

/** DESIGN.md, Constellation header: past about 30 tasks the chart draws dots (MX-X). */
export const COMPACT_PAST = 30;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const LegendDot = ({ color, label, strong }: { color: string; label: string; strong: boolean }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text
        style={[styles.legend, { color: strong ? colours.textDefault : colours.textSubtle }]}
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
};

/** "1 claim to review · 1 blocked · 2 working · 3 waiting"; compact keeps only what needs you. */
const Legend = ({ counts, compact }: { counts: StarCounts; compact: boolean }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  const quiet = [
    counts.working > 0 ? `${counts.working} working` : null,
    counts.waiting > 0 ? `${counts.waiting} waiting` : null,
  ].filter((p) => p !== null);

  const empty = counts.review + counts.blocked + counts.failed + quiet.length === 0;

  return (
    <>
      {counts.review === 0 ? null : (
        <LegendDot
          color={colours.needsYou}
          label={
            compact
              ? plural(counts.review, "claim", "claims")
              : plural(counts.review, "claim to review", "claims to review")
          }
          strong
        />
      )}
      {counts.blocked === 0 ? null : (
        <LegendDot color={colours.failed} label={`${counts.blocked} blocked`} strong={false} />
      )}
      {counts.failed === 0 ? null : (
        <LegendDot color={colours.failed} label={`${counts.failed} failed`} strong={false} />
      )}
      {compact || (quiet.length === 0 && !empty) ? null : (
        <Text style={styles.quiet} maxFontSizeMultiplier={CHROME_TEXT_SCALE} numberOfLines={1}>
          {empty ? `${counts.done} done` : quiet.join(" · ")}
        </Text>
      )}
    </>
  );
};

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
  const counts = starCounts(chart.tasks);
  const compact = chart.tasks.length > COMPACT_PAST;

  return (
    <View style={styles.panel}>
      <View style={styles.top}>
        <Text style={styles.kicker} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          CONSTELLATION
        </Text>
        <Text style={styles.done} maxFontSizeMultiplier={CHROME_TEXT_SCALE} numberOfLines={1}>
          {counts.done} of {counts.total} done
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
      <StarChart
        tasks={chart.tasks}
        bands={chart.bands}
        compact={compact}
        selectedTaskId={selectedTaskId}
        onPressTask={onPressTask}
      />
      <View style={[styles.foot, compact && styles.footRule]}>
        <Legend counts={counts} compact={compact} />
        {compact ? (
          <>
            <View style={styles.spacer} />
            <Pressable accessibilityRole="button" hitSlop={10} onPress={onViewAll}>
              <Text style={styles.viewAll} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
                View all tasks ›
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
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
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    flex: 1,
    color: colours.textDefault,
  },
  chip: {
    flexShrink: 0,
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
  foot: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12, rowGap: 4 },
  footRule: { paddingTop: 8, borderTopWidth: 1, borderTopColor: colours.hairline },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legend: { fontFamily: mobileFont.sans, fontSize: 12, lineHeight: 16 },
  quiet: { fontFamily: mobileFont.sans, fontSize: 12, lineHeight: 16, color: colours.textFaint },
  spacer: { flex: 1 },
  viewAll: {
    fontFamily: mobileFont.sans,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: colours.textDefault,
  },
}));
