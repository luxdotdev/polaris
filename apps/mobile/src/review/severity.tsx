/**
 * Severity in plain Views (DESIGN.md, Risk Findings): ◆ Critical, ▲ High, ● Medium, ○ Low. The
 * shape always comes with the colour, so the glyphs read without colour vision.
 */
import type { Severity } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { StyleSheet, Text, View } from "react-native";
import { SEVERITIES, type Tally } from "./model.ts";

export const severityColour: Readonly<Record<Severity, string>> = {
  critical: midnight.severityCritical,
  high: midnight.severityHigh,
  medium: midnight.severityMedium,
  low: midnight.severityLow,
};

export const severityText: Readonly<Record<Severity, string>> = {
  critical: midnight.severityCriticalText,
  high: midnight.severityHighText,
  medium: midnight.severityMediumText,
  low: midnight.severityLowText,
};

export const severityFill: Readonly<Record<Severity, string>> = {
  critical: midnight.severityCriticalFill,
  high: midnight.severityHighFill,
  medium: midnight.severityMediumFill,
  low: midnight.severityLowFill,
};

export const severityLabel: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SeverityGlyph = ({
  severity,
  size = 8,
  colour = severityColour[severity],
}: {
  readonly severity: Severity;
  readonly size?: number;
  readonly colour?: string;
}) => {
  if (severity === "critical") {
    const side = Math.round(size / Math.SQRT2);

    return (
      <View style={[styles.box, { width: size, height: size }]}>
        <View
          style={{
            width: side,
            height: side,
            backgroundColor: colour,
            transform: [{ rotate: "45deg" }],
          }}
        />
      </View>
    );
  }

  if (severity === "high")
    return (
      <View
        style={[
          styles.triangle,
          {
            borderLeftWidth: size / 2 + 0.5,
            borderRightWidth: size / 2 + 0.5,
            borderBottomWidth: size,
            borderBottomColor: colour,
          },
        ]}
      />
    );

  return (
    <View
      style={[
        { width: size - 1, height: size - 1, borderRadius: size },
        severity === "medium"
          ? { backgroundColor: colour }
          : { borderWidth: 1.5, borderColor: colour },
      ]}
    />
  );
};

export const SeverityBadge = ({ severity }: { readonly severity: Severity }) => (
  <View
    style={[styles.badge, { backgroundColor: severityFill[severity] }]}
    accessibilityLabel={`${severityLabel[severity]} finding`}
  >
    <SeverityGlyph severity={severity} size={8} />
    <Text style={[styles.badgeText, { color: severityText[severity] }]}>
      {severityLabel[severity]}
    </Text>
  </View>
);

/** The four-cell tally: zero cells go faint; an open Critical is outlined. */
export const SeverityTally = ({ counts }: { readonly counts: Tally }) => (
  <View style={styles.tally}>
    {SEVERITIES.map((severity) => {
      const count = counts[severity];
      const zero = count === 0;

      return (
        <View
          key={severity}
          accessibilityLabel={`${count} ${severityLabel[severity].toLowerCase()}`}
          style={[
            styles.cell,
            { backgroundColor: zero ? midnight.surfaceSunken : severityFill[severity] },
            severity === "critical" && !zero ? styles.criticalCell : null,
          ]}
        >
          <SeverityGlyph
            severity={severity}
            size={9}
            colour={zero ? midnight.textFaint : severityColour[severity]}
          />
          <Text
            style={[styles.count, { color: zero ? midnight.textFaint : severityText[severity] }]}
          >
            {count}
          </Text>
        </View>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  badgeText: { ...mobileType.index, fontFamily: mobileType.footnote.fontFamily },
  tally: { flexDirection: "row", gap: 6 },
  cell: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  criticalCell: { borderWidth: 1, borderColor: `${midnight.severityCritical}40` },
  count: { ...mobileType.subhead, fontWeight: "500" },
});
