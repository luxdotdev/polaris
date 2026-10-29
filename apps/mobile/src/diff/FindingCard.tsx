/**
 * A Risk Finding under the line it flags, inside a diff (Paper MX-Q): a raised card with its
 * severity's edge, title, meta and reason, and the fix and ask buttons when the caller has them.
 */
import type { RiskFinding } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { memo } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { LeadGlyph, severityColour, severityLabel } from "../review/severity.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { ACCESSIBILITY_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import type { DiffFindingActions } from "./types.ts";

export const DiffFindingCard = memo(function DiffFindingCard({
  finding,
  actions,
}: {
  readonly finding: RiskFinding;
  readonly actions?: DiffFindingActions | undefined;
}) {
  const styles = useStyles();
  const { colours } = useTheme();
  const askReviewer = actions?.askReviewer;
  const wraps = useWindowDimensions().fontScale >= ACCESSIBILITY_SCALE;

  return (
    <View style={styles.inset}>
      <View style={[styles.card, { borderLeftColor: severityColour(colours, finding.severity) }]}>
        <View style={[styles.head, wraps && styles.wraps]}>
          <LeadGlyph severity={finding.severity} size={10} lineHeight={18} />
          <Text style={styles.title} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {finding.title}
          </Text>
          <Text
            style={[styles.meta, wraps && styles.under]}
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          >
            {severityLabel[finding.severity]} · {Math.round(finding.confidence * 100)}%
          </Text>
        </View>
        {finding.reason === "" ? null : (
          <Text style={styles.reason} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {finding.reason}
          </Text>
        )}
        {actions === undefined ? null : (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              style={styles.primary}
              onPress={() => actions.askToFix(finding)}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
                Ask {actions.harnessName} to fix
              </Text>
            </Pressable>
            {askReviewer === undefined ? null : (
              <Pressable
                accessibilityRole="button"
                style={styles.secondary}
                onPress={() => askReviewer(finding)}
              >
                <Text style={styles.secondaryText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
                  Ask the reviewer
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
});

const pill = {
  height: 30,
  paddingHorizontal: 12,
  borderRadius: 999,
  justifyContent: "center",
} as const;

const useStyles = themedStyles((colours) => ({
  inset: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  card: {
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  /** At accessibility sizes the meta goes under the title, which keeps the row's width. */
  wraps: { flexWrap: "wrap" },
  under: { width: "100%", paddingLeft: 18, marginTop: 0 },
  title: { ...mobileType.subhead, fontWeight: "500", color: colours.textStrong, flex: 1 },
  meta: {
    ...mobileType.index,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    color: colours.textSubtle,
  },
  reason: { ...mobileType.footnote, color: colours.textSubtle },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  primary: { ...pill, backgroundColor: colours.textStrong },
  primaryText: { ...mobileType.footnote, lineHeight: 16, fontWeight: "500", color: colours.panel },
  secondary: { ...pill, borderWidth: 1, borderColor: colours.hairline },
  secondaryText: {
    ...mobileType.footnote,
    lineHeight: 16,
    fontWeight: "500",
    color: colours.textDefault,
  },
}));
