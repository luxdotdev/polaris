/** Home's head (Paper H4): "Sessions", the hosts pill, the summary in tabular numerals, workspace chips. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { counted } from "../model/format.ts";
import type { Home } from "../model/home.ts";

const Chevron = () => (
  <View style={styles.chevron}>
    <View style={[styles.chevronArm, { transform: [{ rotate: "45deg" }], left: 0 }]} />
    <View style={[styles.chevronArm, { transform: [{ rotate: "-45deg" }], left: 3.6 }]} />
  </View>
);

export const HostsPill = ({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}) => (
  <Pressable accessibilityRole="button" onPress={onPress} style={styles.pill}>
    <View style={styles.pillDot} />
    <Text style={styles.pillLabel}>{counted(count, "host")}</Text>
    <Chevron />
  </Pressable>
);

const Summary = ({ home }: { readonly home: Home }) => {
  const parts: Array<{ readonly text: string; readonly color: string }> = [];

  if (home.needsYou > 0)
    parts.push({ text: `${home.needsYou} need you`, color: midnight.needsYouText });

  if (home.working > 0 || parts.length === 0)
    parts.push({ text: `${home.working} working`, color: midnight.textSubtle });

  if (home.attention !== null) parts.push({ text: home.attention, color: midnight.textFaint });

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
}) => (
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
          {chip.name === null ? <Text style={styles.chipCount}>{home.workspaceCount}</Text> : null}
        </Pressable>
      );
    })}
  </ScrollView>
);

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
}) => (
  <View style={styles.header}>
    <View style={styles.titleRow}>
      <Text style={styles.title} accessibilityRole="header">
        Sessions
      </Text>
      {home.hostCount > 0 ? <HostsPill count={home.hostCount} onPress={onHosts} /> : null}
    </View>
    {home.hostCount > 0 ? <Summary home={home} /> : null}
    {home.workspaceCount > 0 ? <Chips home={home} selected={selected} onSelect={onSelect} /> : null}
  </View>
);

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 12 },
  titleRow: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { ...mobileType.largeTitle, color: midnight.textStrong },
  pill: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  pillDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: "#6e7280" },
  pillLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.textDefault },
  chevron: { width: 10, height: 10, justifyContent: "center" },
  chevronArm: {
    position: "absolute",
    top: 4.5,
    width: 5,
    height: 1.4,
    borderRadius: 1,
    backgroundColor: midnight.textFaint,
  },
  summary: {
    ...mobileType.callout,
    lineHeight: 20,
    color: midnight.textSubtle,
    fontVariant: ["tabular-nums"],
  },
  dot: { color: midnight.textSubtle },
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
    borderColor: midnight.hairline,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: midnight.surfaceRaised },
  chipLabel: { ...mobileType.subhead, color: midnight.textSubtle, flexShrink: 1 },
  chipLabelActive: {
    ...mobileType.subhead,
    fontWeight: "500",
    color: midnight.textDefault,
    flexShrink: 1,
  },
  chipCount: { ...mobileType.subhead, color: midnight.textFaint, fontVariant: ["tabular-nums"] },
});
