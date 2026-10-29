/**
 * The chart's legend row (MX-W, MX-X): claims to review in amber, blocked or failed in red, the
 * rest faint; compressed, it ends with "View all tasks ›" when `onViewAll` is given.
 */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles } from "../theme/index.ts";
import { isCompact } from "./layout.ts";
import { legend } from "./legend.ts";
import type { StarTask } from "./types.ts";

export interface StarLegendProps {
  readonly tasks: ReadonlyArray<StarTask>;
  /** As on `StarChart`: past about 30 tasks when omitted. */
  readonly compact?: boolean;
  /** Opens the "View all tasks" list sheet (MX-X). */
  readonly onViewAll?: () => void;
}

export const StarLegend = ({ tasks, compact, onViewAll }: StarLegendProps) => {
  const styles = useStyles();
  const dots = isCompact(tasks, compact);
  const { review, trouble, rest } = legend(tasks, dots);

  return (
    <View style={[styles.row, dots ? styles.rule : null]}>
      {review === null ? null : (
        <View style={styles.item}>
          <View style={[styles.key, styles.review]} />
          <Text style={styles.strong} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {review}
          </Text>
        </View>
      )}
      {trouble === null ? null : (
        <View style={styles.item}>
          <View style={[styles.key, styles.trouble]} />
          <Text style={styles.subtle} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {trouble}
          </Text>
        </View>
      )}
      {rest === null ? null : (
        <Text style={styles.faint} numberOfLines={1} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          {rest}
        </Text>
      )}
      {dots && onViewAll !== undefined ? (
        <Pressable
          accessibilityRole="button"
          onPress={onViewAll}
          hitSlop={8}
          style={styles.viewAll}
        >
          <Text style={styles.link} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            View all tasks ›
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const caption = { fontFamily: mobileType.footnote.fontFamily, fontSize: 12, lineHeight: 16 };

const useStyles = themedStyles((colours) => ({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12, rowGap: 4 },
  rule: { borderTopWidth: 1, borderTopColor: colours.hairline, paddingTop: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 5 },
  key: { width: 8, height: 8, borderRadius: 4 },
  review: { backgroundColor: colours.needsYou },
  trouble: { backgroundColor: colours.failed },
  strong: { ...caption, color: colours.textDefault },
  subtle: { ...caption, color: colours.textSubtle },
  faint: { ...caption, color: colours.textFaint, flexShrink: 1 },
  viewAll: { marginLeft: "auto" },
  link: { ...mobileType.footnote, fontWeight: "500", color: colours.textDefault },
}));
