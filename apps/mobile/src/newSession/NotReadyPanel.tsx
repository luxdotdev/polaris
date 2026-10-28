/**
 * With no Harness ready on the Host (DESIGN.md, New session): each one's reason in a line and its
 * fix on the Host, its setup guide when missing or too old, and Check again. Neutral, never a signal.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NotReadyHarness } from "./harness.ts";
import { HarnessTile } from "./parts.tsx";

export const NotReadyPanel = ({
  hostName,
  harnesses,
  onCheckAgain,
}: {
  readonly hostName: string;
  readonly harnesses: ReadonlyArray<NotReadyHarness>;
  readonly onCheckAgain: () => void;
}) => (
  <View style={styles.panel}>
    <Text style={styles.lead}>
      Polaris drives the harnesses you already have. Set one up on {hostName}, then check again.
    </Text>
    {harnesses.map((harness) => (
      <View key={harness.kind} style={styles.row}>
        <HarnessTile harness={harness.kind} />
        <View style={styles.text}>
          <Text style={styles.reason}>{harness.reason}</Text>
          <Text style={styles.remedy}>{harness.remedy}</Text>
          {harness.docsUrl === null ? null : (
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => {
                if (harness.docsUrl !== null) void Linking.openURL(harness.docsUrl);
              }}
            >
              <Text style={styles.action}>Open setup guide</Text>
            </Pressable>
          )}
        </View>
      </View>
    ))}
    <Pressable
      accessibilityRole="button"
      onPress={onCheckAgain}
      hitSlop={8}
      style={styles.checkAgain}
    >
      <Text style={styles.action}>Check again</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  panel: {
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  lead: { ...mobileType.footnote, color: midnight.textSubtle },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  reason: { ...mobileType.callout, color: midnight.textDefault },
  remedy: { ...mobileType.footnote, color: midnight.textSubtle },
  action: { ...mobileType.label, color: midnight.textDefault },
  checkAgain: { alignSelf: "flex-start" },
});
