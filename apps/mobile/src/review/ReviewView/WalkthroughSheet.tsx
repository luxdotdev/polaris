/**
 * The walkthrough (Paper MX-U): the turn's intent groups in review order, each a well with its
 * number, category, label, why and paths. A group that needs extra care borrows the Critical tint.
 */
import type { IntentGroup } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { MarkdownLine } from "../../markdown/index.ts";
import { InstrumentSheet, SheetHeader } from "../../sheet/index.tsx";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import { SeverityGlyph, severityText } from "../severity.tsx";
import { walkthroughCaption } from "./walkthrough.ts";

export interface WalkthroughSheetProps {
  /** The groups to show; null keeps the sheet closed. */
  readonly groups: ReadonlyArray<IntentGroup> | null;
  readonly turnNumber: number;
  readonly onClose: () => void;
}

const Care = () => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.care}>
      <SeverityGlyph severity="critical" size={7} />
      <Text
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
        style={[styles.careText, { color: severityText(colours, "critical") }]}
      >
        Needs extra care
      </Text>
    </View>
  );
};

const Group = ({ group, number }: { readonly group: IntentGroup; readonly number: number }) => {
  const styles = useStyles();

  return (
    <View style={[styles.group, group.critical && styles.critical]}>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.number}>
        {number}
      </Text>
      <View style={styles.body}>
        <View style={styles.kickerRow}>
          <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.kicker}>
            {group.category.toUpperCase()}
          </Text>
          {group.critical ? <Care /> : null}
        </View>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.label}>
          {group.label}
        </Text>
        <MarkdownLine text={group.summary} style={styles.summary} />
        {group.paths.map((path) => (
          <Text
            key={path}
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            numberOfLines={1}
            style={styles.path}
          >
            {path}
          </Text>
        ))}
      </View>
    </View>
  );
};

export const WalkthroughSheet = ({ groups, turnNumber, onClose }: WalkthroughSheetProps) => {
  const styles = useStyles();

  return (
    <InstrumentSheet open={groups !== null} onClose={onClose}>
      <SheetHeader title="Walkthrough" onClose={onClose} />
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.caption}>
        {walkthroughCaption(turnNumber, groups ?? [])}
      </Text>
      {(groups ?? []).map((group, i) => (
        <Group key={group.key} group={group} number={i + 1} />
      ))}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((colours) => ({
  caption: { ...mobileType.footnote, color: colours.textSubtle, paddingHorizontal: 8 },
  group: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  critical: { borderColor: `${colours.severityCritical}40` },
  number: {
    ...mobileType.index,
    fontSize: 13,
    lineHeight: 20,
    width: 14,
    color: colours.textFaint,
  },
  body: { flex: 1, gap: 6, minWidth: 0 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: {
    ...mobileType.index,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.9,
    color: colours.textSubtle,
  },
  care: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: `${colours.severityCritical}1f`,
  },
  careText: { ...mobileType.tab, fontSize: 11, lineHeight: 14 },
  label: { ...mobileType.heading, color: colours.textStrong },
  summary: { ...mobileType.subhead, lineHeight: 20, color: colours.textSubtle },
  path: { ...mobileType.index, lineHeight: 17, color: colours.textFaint },
}));
