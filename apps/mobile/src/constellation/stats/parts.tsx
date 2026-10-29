/** Pieces the claim and stats sheets share (Paper MX-AA, MX-AB): the kicker head and close. */
import { mobileFont } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";

/** Mono caps over the sheet's subject ("CLAIM · B3 · ATTEMPT 2"), with a dot before it if given. */
export const Kicker = ({ text, dot }: { readonly text: string; readonly dot?: string }) => {
  const styles = useStyles();

  return (
    <View style={styles.kickerRow}>
      {dot === undefined ? null : <View style={[styles.dot, { backgroundColor: dot }]} />}
      <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.kicker}>
        {text.toUpperCase()}
      </Text>
    </View>
  );
};

/** The sheet's head: its subject on the leading side, a round close at the trailing edge. */
export const SheetHead = ({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.head}>
      <View style={styles.subject}>{children}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        onPress={onClose}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Svg width={12} height={12} viewBox="0 0 12 12">
          <Path
            d="M1 1l10 10M11 1L1 11"
            stroke={colours.textSubtle}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  subject: { flex: 1, minWidth: 0, gap: 4 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  pressed: { transform: [{ scale: 0.94 }] },
}));
