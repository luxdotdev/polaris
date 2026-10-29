/** One sheet as the host draws it: the scrim, the sheet at its detent, and its parts. */
import { useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { DEFAULT_DETENTS, detentHeights, openingIndex } from "./detents.ts";
import type { InstrumentSheetProps } from "./host.tsx";
import { GRABBER, SCRIM, SHEET_EDGE, sections } from "./layout.tsx";
import { useKeyboard } from "./useKeyboard.ts";

export const SheetFrame = ({
  open,
  onClose,
  detents = DEFAULT_DETENTS,
  children,
}: InstrumentSheetProps) => {
  const { colours, name } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const keyboard = useKeyboard(open);
  const room = { height: window.height - keyboard.height, topInset: insets.top };
  const heights = detentHeights(detents, room);
  const [index] = useState(openingIndex(heights));

  useEffect(() => {
    if (!open) return;

    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();

      return true;
    });

    return () => sub.remove();
  }, [open, onClose]);

  if (!open) return null;

  const height = heights[Math.min(index, heights.length - 1)] ?? 0;
  const { header, body, footer } = sections(children);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM[name] }]}
      />
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={[
          styles.sheet,
          {
            height,
            bottom: keyboard.height,
            backgroundColor: colours.panel,
            paddingBottom: keyboard.height > 0 ? 10 : Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>
        {header}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
        {footer}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderTopWidth: 1,
    borderColor: SHEET_EDGE,
    paddingTop: 8,
    paddingHorizontal: 10,
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -12 },
  },
  grabberRow: { alignItems: "center", paddingBottom: 4 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: GRABBER },
  body: { flex: 1, marginHorizontal: -10 },
  bodyContent: { gap: 10, paddingHorizontal: 10 },
});
