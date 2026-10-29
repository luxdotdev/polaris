/**
 * The severity pager: MX-N's four readout cells in the hero, and MX-O's compact pill row pinned
 * under the header once they scroll away. A tap pages to that severity's next finding; an empty
 * severity shows its zero and does nothing.
 */
import type { Severity } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { type MobileColours, themedStyles, useTheme } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { SEVERITIES, type Tally } from "../model.ts";
import { severityColour, SeverityGlyph, severityLabel, severityText } from "../severity.tsx";
import { type PagerPositions, pillCount } from "./pager.ts";

export interface SeverityPagerProps {
  readonly counts: Tally;
  readonly positions: PagerPositions;
  readonly onPage: (severity: Severity) => void;
  /** MX-O's one-line pills, for the row pinned under the header. */
  readonly compact?: boolean;
}

const numberColour = (colours: MobileColours, severity: Severity) =>
  severity === "critical" || severity === "low"
    ? severityText(colours, severity)
    : severityColour(colours, severity);

const Cell = ({
  severity,
  count,
  position,
  compact,
  onPage,
}: {
  readonly severity: Severity;
  readonly count: number;
  readonly position: number | null;
  readonly compact: boolean;
  readonly onPage: (severity: Severity) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const tinted = severity === "critical" && count > 0;
  const label = severityLabel[severity];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label.toLowerCase()}`}
      accessibilityHint={count > 0 ? `Shows the next ${label.toLowerCase()} finding` : undefined}
      accessibilityState={{ disabled: count === 0 }}
      disabled={count === 0}
      onPress={() => onPage(severity)}
      style={({ pressed }) => [
        compact ? styles.pill : styles.cell,
        tinted ? styles.tinted : styles.plain,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.countRow}>
        <SeverityGlyph severity={severity} size={compact ? 8 : 9} />
        <Text
          maxFontSizeMultiplier={CHROME_TEXT_SCALE}
          style={[
            compact ? styles.pillCount : styles.count,
            { color: numberColour(colours, severity) },
          ]}
        >
          {pillCount(count, position)}
        </Text>
      </View>
      {compact ? null : (
        <Text
          maxFontSizeMultiplier={CHROME_TEXT_SCALE}
          style={[styles.label, tinted && { color: severityText(colours, "critical") }]}
        >
          {label.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
};

export const SeverityPager = ({
  counts,
  positions,
  onPage,
  compact = false,
}: SeverityPagerProps) => {
  const styles = useStyles();

  return (
    <View style={compact ? styles.pills : styles.cells}>
      {SEVERITIES.map((severity) => (
        <Cell
          key={severity}
          severity={severity}
          count={counts[severity]}
          position={positions[severity]}
          compact={compact}
          onPage={onPage}
        />
      ))}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  cells: { flexDirection: "row", gap: 6 },
  pills: { flexDirection: "row", gap: 4 },
  cell: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingVertical: 4,
  },
  pill: {
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  plain: { backgroundColor: colours.well, borderColor: "transparent" },
  tinted: {
    backgroundColor: `${colours.severityCritical}1f`,
    borderColor: `${colours.severityCritical}40`,
  },
  pressed: { opacity: 0.7 },
  countRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  count: { ...mobileType.label, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pillCount: {
    ...mobileType.footnote,
    lineHeight: 16,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  label: {
    ...mobileType.index,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: colours.textSubtle,
  },
}));
