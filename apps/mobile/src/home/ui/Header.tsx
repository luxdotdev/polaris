/**
 * Home's head (MX-C): the large title, the needs you badge and hosts pill, the summary in
 * tabular numerals, and workspace chips as panels on the ground.
 */
import { mobileType, mobileWeight } from "@polaris/ui/tokens";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { counted } from "../model/format.ts";
import type { Home } from "../model/home.ts";
import { NeedsYouBadge } from "./NeedsYouBadge.tsx";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";

const useStyles = themedStyles((c) => ({
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14, gap: 8 },
  titleRow: {
    minHeight: 41,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { ...mobileType.largeTitle, color: c.textStrong },
  pills: { flexDirection: "row", gap: 8 },
  pill: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.panel,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.textFaint },
  pillLabel: { ...mobileType.subhead, fontWeight: mobileWeight.medium, color: c.textDefault },
  summary: { ...mobileType.callout, lineHeight: 20, fontVariant: ["tabular-nums"] },
  needsYou: { fontWeight: mobileWeight.medium, color: c.needsYouText },
  rest: { color: c.textSubtle },
  chipsScroll: { marginHorizontal: -16 },
  chips: { gap: 8, paddingHorizontal: 16 },
  chip: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.panel,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: c.raised },
  chipLabel: {
    ...mobileType.subhead,
    fontWeight: mobileWeight.medium,
    color: c.textDefault,
    flexShrink: 1,
  },
  chipLabelActive: { color: c.textStrong },
  chipCount: {
    ...mobileType.footnote,
    lineHeight: 16,
    fontWeight: mobileWeight.medium,
    color: c.textSubtle,
    fontVariant: ["tabular-nums"],
  },
}));

const ChevronDown = ({ color }: { readonly color: string }) => (
  <Svg width={10} height={10} viewBox="0 0 10 10">
    <Path
      d="M2 3.5l3 3 3-3"
      fill="none"
      stroke={color}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const HostsPill = ({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pill}>
      <View style={styles.pillDot} />
      <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.pillLabel}>
        {counted(count, "host")}
      </Text>
      <ChevronDown color={colours.textFaint} />
    </Pressable>
  );
};

/** "2 need you · 3 working · lucas-rpi reconnecting". */
const Summary = ({ home }: { readonly home: Home }) => {
  const styles = useStyles();
  const rest: Array<string> = [];

  // The empty state says it when there is nothing; "0 working" would only repeat it.
  if (home.working > 0 || (home.needsYou === 0 && home.empty === null))
    rest.push(`${home.working} working`);

  if (home.attention !== null) rest.push(home.attention);

  const needsYou = home.needsYou > 0 ? `${home.needsYou} need you` : null;

  return (
    <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.summary} numberOfLines={2}>
      {needsYou === null ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.needsYou}>
          {needsYou}
        </Text>
      )}
      {rest.length === 0 ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.rest}>
          {(needsYou === null ? "" : " · ") + rest.join(" · ")}
        </Text>
      )}
    </Text>
  );
};

const Chips = ({
  home,
  selected,
  onSelect,
}: {
  readonly home: Home;
  readonly selected: string | null;
  readonly onSelect: (name: string | null) => void;
}) => {
  const styles = useStyles();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      style={styles.chipsScroll}
    >
      {home.chips.map((chip) => {
        const active = chip.name === selected;

        return (
          <Pressable
            key={chip.name ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(chip.name)}
            style={[styles.chip, active ? styles.chipActive : null]}
          >
            <Text
              maxFontSizeMultiplier={CHROME_TEXT_SCALE}
              style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
              numberOfLines={1}
            >
              {chip.label}
            </Text>
            {chip.name === null ? (
              <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.chipCount}>
                {home.workspaceCount}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

export const Header = ({
  home,
  selected,
  onSelect,
  onHosts,
  onInbox,
}: {
  readonly home: Home;
  readonly selected: string | null;
  readonly onSelect: (name: string | null) => void;
  readonly onHosts: () => void;
  /** Opens the needs you inbox sheet (MX-H). */
  readonly onInbox: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text
          maxFontSizeMultiplier={CHROME_TEXT_SCALE}
          style={styles.title}
          accessibilityRole="header"
        >
          Sessions
        </Text>
        <View style={styles.pills}>
          <NeedsYouBadge count={home.needsYou} onPress={onInbox} />
          {home.hostCount > 0 ? <HostsPill count={home.hostCount} onPress={onHosts} /> : null}
        </View>
      </View>
      {home.hostCount > 0 ? <Summary home={home} /> : null}
      {home.workspaceCount > 0 ? (
        <Chips home={home} selected={selected} onSelect={onSelect} />
      ) : null}
    </View>
  );
};
