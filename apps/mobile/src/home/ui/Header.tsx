/**
 * Home's head (MX-C): the large title, the needs you badge and hosts pill, the summary in
 * tabular numerals, and workspace chips as panels on the ground.
 */
import { mobileType, mobileWeight } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type MobileColours, useTheme } from "../../theme";
import { counted } from "../model/format.ts";
import type { Home } from "../model/home.ts";

const makeStyles = (c: MobileColours) =>
  StyleSheet.create({
    header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14, gap: 8 },
    titleRow: {
      height: 41,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { ...mobileType.largeTitle, color: c.textStrong },
    pills: { flexDirection: "row", gap: 8 },
    pill: {
      height: 32,
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
    badgeCount: {
      ...mobileType.subhead,
      fontWeight: mobileWeight.medium,
      color: c.needsYouText,
      fontVariant: ["tabular-nums"],
    },
    summary: { ...mobileType.callout, lineHeight: 20, fontVariant: ["tabular-nums"] },
    needsYou: { fontWeight: mobileWeight.medium, color: c.needsYouText },
    rest: { color: c.textSubtle },
    chipsScroll: { marginHorizontal: -16 },
    chips: { gap: 8, paddingHorizontal: 16 },
    chip: {
      height: 32,
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
  });

const useStyles = () => {
  const { colours } = useTheme();

  return useMemo(() => makeStyles(colours), [colours]);
};

/** The four-point needs you spark (Paper MX-C). */
export const Spark = ({ size, color }: { readonly size: number; readonly color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path d="M6 0.5 L7.1 4.9 L11.5 6 L7.1 7.1 L6 11.5 L4.9 7.1 L0.5 6 L4.9 4.9 Z" fill={color} />
  </Svg>
);

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

/** Placeholder for S6's `NeedsYouBadge` (home/ui/NeedsYouBadge), with its agreed props. */
const NeedsYouBadge = ({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} need you`}
      onPress={onPress}
      style={[styles.pill, { gap: 6 }]}
    >
      <Spark size={12} color={colours.needsYou} />
      <Text style={styles.badgeCount}>{count}</Text>
    </Pressable>
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
  const { colours } = useTheme();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pill}>
      <View style={styles.pillDot} />
      <Text style={styles.pillLabel}>{counted(count, "host")}</Text>
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
    <Text style={styles.summary} numberOfLines={2}>
      {needsYou === null ? null : <Text style={styles.needsYou}>{needsYou}</Text>}
      {rest.length === 0 ? null : (
        <Text style={styles.rest}>{(needsYou === null ? "" : " · ") + rest.join(" · ")}</Text>
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
              style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
              numberOfLines={1}
            >
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
        <Text style={styles.title} accessibilityRole="header">
          Sessions
        </Text>
        <View style={styles.pills}>
          {home.needsYou > 0 ? <NeedsYouBadge count={home.needsYou} onPress={onInbox} /> : null}
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
