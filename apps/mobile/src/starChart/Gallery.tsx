/**
 * A development screen of the star chart in MX-W's header panel: 12 tasks, 14 wrapping waves and
 * 64 tasks (MX-X). Launch a development build with `-polarisDevStarChart 1` (`-polarisDevTheme`).
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Settings, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemeName, themedStyles, useTheme } from "../theme/index.ts";
import { BANDS, LARGE, SMALL, WRAPPING } from "./fixtures.testing.ts";
import { StarChart } from "./StarChart.tsx";
import { StarLegend } from "./StarLegend.tsx";
import type { StarTask } from "./types.ts";

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const ON = __DEV__ && launchArgument("polarisDevStarChart", Schema.is(Schema.String)) !== null;

export const starChartGalleryOn = (): boolean => ON;

const Panel = ({
  tasks,
  stats,
}: {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly stats: string;
}) => {
  const styles = useStyles();
  const [selected, setSelected] = useState<string | null>(null);
  const done = tasks.filter((task) => task.state === "done").length;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.kicker}>CONSTELLATION</Text>
        <Text style={styles.count}>
          {done} of {tasks.length} done
        </Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{stats}</Text>
        </View>
      </View>
      <StarChart
        tasks={tasks}
        bands={BANDS}
        selectedTaskId={selected}
        onPressTask={(id) => setSelected((current) => (current === id ? null : id))}
      />
      <StarLegend tasks={tasks} onViewAll={() => undefined} />
    </View>
  );
};

export const StarChartGallery = () => {
  const { colours, setTheme } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  return (
    <ScrollView
      style={{ backgroundColor: colours.ground }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, gap: 16 }}
    >
      <Panel tasks={SMALL} stats="$4.82 · 1h 12m ›" />
      <Panel tasks={WRAPPING} stats="$9.10 · 2h 40m ›" />
      <Panel tasks={LARGE} stats="$18.40 · 3h 05m ›" />
    </ScrollView>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: {
    backgroundColor: colours.panel,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
  },
  count: { ...mobileType.footnote, flex: 1, color: colours.textDefault },
  chip: {
    backgroundColor: colours.raised,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  chipText: { ...mobileType.index, color: colours.textDefault },
}));
