/**
 * The review queue's head (Paper MX-K): the large title with the needs you badge and hosts pill,
 * "1 critical · 4 turns to review", and workspace chips.
 */
import { mobileType, mobileWeight } from "@polaris/ui/tokens";
import { Pressable, ScrollView, Text, View } from "react-native";
import { HostsPill } from "../../home/ui/Header.tsx";
import { InboxBadge } from "../../inbox/index.ts";
import { themedStyles } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { type Queue, queueSummary } from "./queue.ts";

export interface QueueHeaderProps {
  readonly queue: Queue | null;
  readonly hostCount: number;
  readonly workspaces: ReadonlyArray<string>;
  readonly selected: string | null;
  readonly onSelect: (workspace: string | null) => void;
  readonly onHosts: () => void;
}

const Summary = ({ queue }: { readonly queue: Queue }) => {
  const styles = useStyles();
  const { critical, rest } = queueSummary(queue);

  return (
    <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.summary} numberOfLines={2}>
      {critical === null ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.critical}>
          {critical}
        </Text>
      )}
      <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.rest}>
        {(critical === null ? "" : " · ") + rest}
      </Text>
    </Text>
  );
};

const Chip = ({
  label,
  count,
  active,
  onPress,
}: {
  readonly label: string;
  readonly count: number | null;
  readonly active: boolean;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
        style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count === null ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.chipCount}>
          {count}
        </Text>
      )}
    </Pressable>
  );
};

export const QueueHeader = ({
  queue,
  hostCount,
  workspaces,
  selected,
  onSelect,
  onHosts,
}: QueueHeaderProps) => {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text
          maxFontSizeMultiplier={CHROME_TEXT_SCALE}
          style={styles.title}
          accessibilityRole="header"
        >
          Review
        </Text>
        <View style={styles.pills}>
          <InboxBadge />
          {hostCount > 0 ? <HostsPill count={hostCount} onPress={onHosts} /> : null}
        </View>
      </View>
      {queue === null || queue.total === 0 ? null : <Summary queue={queue} />}
      {workspaces.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}
        >
          <Chip
            label="All workspaces"
            count={workspaces.length}
            active={selected === null}
            onPress={() => onSelect(null)}
          />
          {workspaces.map((name) => (
            <Chip
              key={name}
              label={name}
              count={null}
              active={selected === name}
              onPress={() => onSelect(name)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
};

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
  summary: { ...mobileType.callout, lineHeight: 20, fontVariant: ["tabular-nums"] },
  critical: { fontWeight: mobileWeight.medium, color: c.severityCriticalText },
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
