/** Home's head (Paper H4): "Sessions", the hosts pill, the summary in tabular numerals, workspace chips. */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, ScrollView, Text, View } from "react-native";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { counted } from "../model/format.ts";
import type { Home } from "../model/home.ts";

const Chevron = () => {
  const styles = useStyles();

  return (
    <View style={styles.chevron}>
      <View style={[styles.chevronArm, { transform: [{ rotate: "45deg" }], left: 0 }]} />
      <View style={[styles.chevronArm, { transform: [{ rotate: "-45deg" }], left: 3.6 }]} />
    </View>
  );
};

export const HostsPill = ({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pill}>
      <View style={styles.pillDot} />
      <Text style={styles.pillLabel}>{counted(count, "host")}</Text>
      <Chevron />
    </Pressable>
  );
};

const Summary = ({ home }: { readonly home: Home }) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const parts: Array<{ readonly text: string; readonly color: string }> = [];

  if (home.needsYou > 0)
    parts.push({ text: `${home.needsYou} need you`, color: colours.needsYouText });

  // The empty state says it when there is nothing; "0 working" would only repeat it.
  if (home.working > 0 || (parts.length === 0 && home.empty === null))
    parts.push({ text: `${home.working} working`, color: colours.textSubtle });

  if (home.attention !== null) parts.push({ text: home.attention, color: colours.textFaint });

  return (
    <Text style={styles.summary} numberOfLines={2}>
      {parts.map((part, index) => (
        <Text key={part.text} style={{ color: part.color }}>
          {index > 0 ? <Text style={styles.dot}> · </Text> : null}
          {part.text}
        </Text>
      ))}
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
            <Text style={active ? styles.chipLabelActive : styles.chipLabel} numberOfLines={1}>
              {chip.label}
            </Text>
            {chip.name === null ? (
              <Text style={styles.chipCount}>{home.workspaceCount}</Text>
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
}: {
  readonly home: Home;
  readonly selected: string | null;
  readonly onSelect: (name: string | null) => void;
  readonly onHosts: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          Sessions
        </Text>
        {home.hostCount > 0 ? <HostsPill count={home.hostCount} onPress={onHosts} /> : null}
      </View>
      {home.hostCount > 0 ? <Summary home={home} /> : null}
      {home.workspaceCount > 0 ? (
        <Chips home={home} selected={selected} onSelect={onSelect} />
      ) : null}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 12 },
  titleRow: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { ...mobileType.largeTitle, color: colours.textStrong },
  pill: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  pillDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: "#6e7280" },
  pillLabel: { ...mobileType.subhead, fontWeight: "500", color: colours.textDefault },
  chevron: { width: 10, height: 10, justifyContent: "center" },
  chevronArm: {
    position: "absolute",
    top: 4.5,
    width: 5,
    height: 1.4,
    borderRadius: 1,
    backgroundColor: colours.textFaint,
  },
  summary: {
    ...mobileType.callout,
    lineHeight: 20,
    color: colours.textSubtle,
    fontVariant: ["tabular-nums"],
  },
  dot: { color: colours.textSubtle },
  chipsScroll: { marginHorizontal: -20 },
  chips: { gap: 8, paddingHorizontal: 20 },
  chip: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: colours.raised },
  chipLabel: { ...mobileType.subhead, color: colours.textSubtle, flexShrink: 1 },
  chipLabelActive: {
    ...mobileType.subhead,
    fontWeight: "500",
    color: colours.textDefault,
    flexShrink: 1,
  },
  chipCount: { ...mobileType.subhead, color: colours.textFaint, fontVariant: ["tabular-nums"] },
}));
