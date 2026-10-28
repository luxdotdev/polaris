/** The floating tab bar and New (Paper H4): Sessions, Review, Hosts, and New beside them. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type Tab = "sessions" | "review" | "hosts";

const SessionsIcon = ({ color }: { readonly color: string }) => (
  <View style={styles.icon}>
    <View style={[styles.line, { top: 4, width: 14, backgroundColor: color }]} />
    <View style={[styles.line, { top: 9, width: 14, backgroundColor: color }]} />
    <View style={[styles.line, { top: 14, width: 9, backgroundColor: color }]} />
  </View>
);

const ReviewIcon = ({ color }: { readonly color: string }) => (
  <View style={styles.icon}>
    <View style={[styles.bubble, { borderColor: color }]} />
    <View style={[styles.tail, { backgroundColor: color }]} />
  </View>
);

const HostsIcon = ({ color }: { readonly color: string }) => (
  <View style={styles.icon}>
    {[4, 11].map((top) => (
      <View key={top} style={[styles.server, { top, borderColor: color }]}>
        <View style={[styles.led, { backgroundColor: color }]} />
      </View>
    ))}
  </View>
);

const TABS: ReadonlyArray<{
  readonly tab: Tab;
  readonly label: string;
  readonly Icon: (props: { readonly color: string }) => React.JSX.Element;
}> = [
  { tab: "sessions", label: "Sessions", Icon: SessionsIcon },
  { tab: "review", label: "Review", Icon: ReviewIcon },
  { tab: "hosts", label: "Hosts", Icon: HostsIcon },
];

export const TabBar = ({
  active,
  reviewCount,
  bottom,
  onSelect,
  onNew,
}: {
  readonly active: Tab;
  readonly reviewCount: number;
  readonly bottom: number;
  readonly onSelect: (tab: Tab) => void;
  readonly onNew: () => void;
}) => (
  <View style={[styles.row, { bottom }]} pointerEvents="box-none">
    <View style={styles.bar} accessibilityRole="tablist">
      {TABS.map(({ tab, label, Icon }) => {
        const selected = tab === active;
        const color = selected ? midnight.textStrong : midnight.textSubtle;

        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onSelect(tab)}
            style={[styles.tab, selected ? styles.tabActive : null]}
          >
            <Icon color={color} />
            <Text style={[styles.label, { color }]}>
              {tab === "review" && reviewCount > 0 ? `${label} · ${reviewCount}` : label}
            </Text>
          </Pressable>
        );
      })}
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New agent session"
      onPress={onNew}
      style={styles.new}
    >
      <View style={[styles.plus, { width: 15, height: 1.5 }]} />
      <View style={[styles.plus, { width: 1.5, height: 15 }]} />
    </Pressable>
  </View>
);

const glass = {
  backgroundColor: "#0a0b0dd9",
  borderWidth: 1,
  borderColor: midnight.hairline,
  borderRadius: 999,
} as const;

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bar: { ...glass, flex: 1, height: 58, padding: 4, flexDirection: "row" },
  tab: {
    flex: 1,
    height: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabActive: { backgroundColor: "#ffffff12" },
  label: { ...mobileType.tab },
  new: { ...glass, width: 58, height: 58, alignItems: "center", justifyContent: "center" },
  plus: { position: "absolute", borderRadius: 1, backgroundColor: midnight.textStrong },
  icon: { width: 20, height: 20 },
  line: { position: "absolute", left: 3, height: 3, borderRadius: 1 },
  bubble: {
    position: "absolute",
    left: 4,
    top: 4,
    width: 12,
    height: 9,
    borderWidth: 1.6,
    borderRadius: 1,
  },
  tail: { position: "absolute", left: 6, top: 12, width: 1.6, height: 4 },
  server: {
    position: "absolute",
    left: 3,
    width: 14,
    height: 5.5,
    borderWidth: 1.4,
    borderRadius: 1.5,
    justifyContent: "center",
  },
  led: { width: 1.8, height: 1.8, borderRadius: 1, marginLeft: 2 },
});
