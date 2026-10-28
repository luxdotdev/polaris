/** The back row atop a pushed screen (Paper M7): a round chevron and where it goes back to. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

export const BackBar = ({
  label,
  onBack,
}: {
  readonly label: string;
  readonly onBack: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Back to ${label}`}
    onPress={onBack}
    style={styles.row}
  >
    <View style={styles.circle}>
      <View style={[styles.arm, { transform: [{ rotate: "-45deg" }], top: 13.4 }]} />
      <View style={[styles.arm, { transform: [{ rotate: "45deg" }], top: 18.6 }]} />
    </View>
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  row: {
    height: 52,
    paddingHorizontal: 16,
    paddingTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  circle: { width: 36, height: 36, borderRadius: 999, backgroundColor: midnight.surfaceRaised },
  arm: {
    position: "absolute",
    left: 13,
    width: 8.5,
    height: 1.6,
    borderRadius: 1,
    backgroundColor: midnight.textDefault,
  },
  label: { ...mobileType.callout, lineHeight: 20, color: midnight.textSubtle },
});
