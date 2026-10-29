/**
 * Severity in plain Views (DESIGN.md, Risk Findings): ◆ Critical, ▲ High, ● Medium, ○ Low. The
 * shape always comes with the colour, so the glyphs read without colour vision.
 */
import type { Severity } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Text, useWindowDimensions, View } from "react-native";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { type MobileColours, themedStyles, useTheme } from "../theme/index.ts";
import { SEVERITIES, type Tally } from "./model.ts";

type ColourKey = keyof MobileColours;

const COLOUR: Readonly<Record<Severity, ColourKey>> = {
  critical: "severityCritical",
  high: "severityHigh",
  medium: "severityMedium",
  low: "severityLow",
};

const TEXT: Readonly<Record<Severity, ColourKey>> = {
  critical: "severityCriticalText",
  high: "severityHighText",
  medium: "severityMediumText",
  low: "severityLowText",
};

const FILL: Readonly<Record<Severity, ColourKey>> = {
  critical: "severityCriticalFill",
  high: "severityHighFill",
  medium: "severityMediumFill",
  low: "severityLowFill",
};

export const severityColour = (colours: MobileColours, severity: Severity): string =>
  colours[COLOUR[severity]];

export const severityText = (colours: MobileColours, severity: Severity): string =>
  colours[TEXT[severity]];

export const severityFill = (colours: MobileColours, severity: Severity): string =>
  colours[FILL[severity]];

export const severityLabel: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** The glyph centred on the first line of a title set at `lineHeight`, as Dynamic Type grows it. */
export const LeadGlyph = ({
  severity,
  size,
  lineHeight,
}: {
  readonly severity: Severity;
  readonly size: number;
  readonly lineHeight: number;
}) => {
  const { fontScale } = useWindowDimensions();

  return (
    <View
      style={{
        height: lineHeight * Math.min(fontScale, CONTENT_TEXT_SCALE),
        justifyContent: "center",
      }}
    >
      <SeverityGlyph severity={severity} size={size} />
    </View>
  );
};

export const SeverityGlyph = ({
  severity,
  size = 8,
  colour,
}: {
  readonly severity: Severity;
  readonly size?: number;
  readonly colour?: string;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const tint = colour ?? severityColour(colours, severity);

  if (severity === "critical") {
    const side = Math.round(size / Math.SQRT2);

    return (
      <View style={[styles.box, { width: size, height: size }]}>
        <View
          style={{
            width: side,
            height: side,
            backgroundColor: tint,
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
            borderBottomColor: tint,
          },
        ]}
      />
    );

  return (
    <View
      style={[
        { width: size - 1, height: size - 1, borderRadius: size },
        severity === "medium" ? { backgroundColor: tint } : { borderWidth: 1.5, borderColor: tint },
      ]}
    />
  );
};

export const SeverityBadge = ({ severity }: { readonly severity: Severity }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View
      style={[styles.badge, { backgroundColor: severityFill(colours, severity) }]}
      accessibilityLabel={`${severityLabel[severity]} finding`}
    >
      <SeverityGlyph severity={severity} size={8} />
      <Text style={[styles.badgeText, { color: severityText(colours, severity) }]}>
        {severityLabel[severity]}
      </Text>
    </View>
  );
};

/** The four-cell tally: zero cells go faint; an open Critical is outlined. */
export const SeverityTally = ({ counts }: { readonly counts: Tally }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
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
              { backgroundColor: zero ? colours.panel : severityFill(colours, severity) },
              severity === "critical" && !zero ? styles.criticalCell : null,
            ]}
          >
            <SeverityGlyph
              severity={severity}
              size={9}
              colour={zero ? colours.textFaint : severityColour(colours, severity)}
            />
            <Text
              style={[
                styles.count,
                { color: zero ? colours.textFaint : severityText(colours, severity) },
              ]}
            >
              {count}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
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
  criticalCell: { borderWidth: 1, borderColor: `${colours.severityCritical}40` },
  count: { ...mobileType.subhead, fontWeight: "500" },
}));
