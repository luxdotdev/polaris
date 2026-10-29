/**
 * The completion card (Paper MX-AC; ENG-532): inline in the lead's thread once its constellation
 * is completed or archived, with the readout the stats sheet draws from `constellation.stats`.
 */
import { mobileType } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { HostConnection } from "../../runtime/hostConnection.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import type { ConstellationSource } from "../model.ts";
import { completionView, reportedPrice } from "./model.ts";
import { Kicker } from "./parts.tsx";
import { useConstellationStats } from "./useStats.ts";

export interface CompletionCardProps {
  readonly source: ConstellationSource;
  readonly connection: HostConnection;
  /** "Review turn 31": the lead's last turn, when there is one to review. */
  readonly reviewTurn?: { readonly label: string; readonly onPress: () => void };
  readonly onViewAllTasks?: () => void;
}

const STARS: ReadonlyArray<readonly [number, number]> = [
  [4, 20],
  [11, 9],
  [18, 16],
  [24, 6],
];

/** The constellation mark: four stars on one line. */
const Mark = () => {
  const { colours } = useTheme();

  return (
    <Svg width={28} height={28} viewBox="0 0 28 28">
      <Path d="M4 20L11 9L18 16L24 6" fill="none" stroke={colours.textFaint} />
      {STARS.map(([cx, cy]) => (
        <Circle key={cx} cx={cx} cy={cy} r={2.5} fill={colours.textDefault} />
      ))}
    </Svg>
  );
};

const Button = ({
  label,
  primary,
  onPress,
}: {
  readonly label: string;
  readonly primary: boolean;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
      ]}
    >
      <Text
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        style={[styles.buttonText, primary ? styles.primaryText : styles.secondaryText]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const CompletionCard = ({
  source,
  connection,
  reviewTurn,
  onViewAllTasks,
}: CompletionCardProps) => {
  const styles = useStyles();
  const c = source.constellation;
  const state = useConstellationStats(connection, c.id, c.revision);
  const stats = state.kind === "ready" ? state.stats : null;

  const view = useMemo(
    () => completionView(c, source.projections, stats, reportedPrice),
    [c, source.projections, stats]
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Mark />
        <View style={styles.titles}>
          <Kicker text={view.kicker} />
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title}>
            {view.title}
          </Text>
        </View>
      </View>
      {view.rows.length === 0 ? null : (
        <View style={styles.readout}>
          {view.rows.map((row, i) => (
            <View key={row.label} style={[styles.row, i > 0 && styles.ruled]}>
              <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.label}>
                {row.label}
              </Text>
              <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.value}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      )}
      {reviewTurn === undefined && onViewAllTasks === undefined ? null : (
        <View style={styles.buttons}>
          {reviewTurn === undefined ? null : (
            <Button label={reviewTurn.label} primary onPress={reviewTurn.onPress} />
          )}
          {onViewAllTasks === undefined ? null : (
            <Button
              label="View all tasks"
              primary={reviewTurn === undefined}
              onPress={onViewAllTasks}
            />
          )}
        </View>
      )}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  card: {
    gap: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: colours.raised,
    borderColor: colours.hairline,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  titles: { flex: 1, minWidth: 0 },
  title: { ...mobileType.title, fontWeight: "600", color: colours.textStrong },
  readout: {
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colours.well,
    borderColor: colours.hairline,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  ruled: { borderTopWidth: 1, borderTopColor: colours.hairline },
  label: { ...mobileType.footnote, color: colours.textSubtle, flexShrink: 0 },
  value: {
    ...mobileType.index,
    fontSize: 13,
    lineHeight: 18,
    color: colours.textDefault,
    flexShrink: 1,
    textAlign: "right",
  },
  buttons: { flexDirection: "row", gap: 8 },
  button: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primary: { backgroundColor: colours.textStrong },
  secondary: { backgroundColor: colours.well, borderWidth: 1, borderColor: colours.hairline },
  pressed: { transform: [{ scale: 0.97 }] },
  buttonText: { ...mobileType.subhead, fontWeight: "600" },
  primaryText: { color: colours.ground },
  secondaryText: { color: colours.textDefault },
}));
