/**
 * The lead's notice over the composer while a claim waits on the user (DESIGN.md phase 2,
 * Sheets): an amber dot, which claim, and Review, which opens the claim sheet (MX-AA).
 */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { themedStyles } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE, CONTROL_TEXT_SCALE } from "../../theme/textScale.ts";
import type { ClaimNotice as Notice } from "./wiring.ts";

export const ClaimNotice = ({
  notice,
  onOpen,
}: {
  readonly notice: Notice;
  readonly onOpen: (taskId: string) => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notice.text}. Review`}
      onPress={() => onOpen(notice.taskId)}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
    >
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {notice.text}
      </Text>
      <View style={styles.review}>
        <Text style={styles.reviewLabel} maxFontSizeMultiplier={CONTROL_TEXT_SCALE}>
          Review
        </Text>
      </View>
    </Pressable>
  );
};

const useStyles = themedStyles((colours) => ({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    backgroundColor: colours.raised,
    borderColor: colours.hairline,
  },
  pressed: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colours.needsYou },
  text: {
    ...mobileType.footnote,
    flex: 1,
    minWidth: 0,
    fontWeight: "500",
    color: colours.needsYouText,
  },
  review: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.textStrong,
  },
  reviewLabel: { ...mobileType.footnote, lineHeight: 16, fontWeight: "500", color: colours.ground },
}));
