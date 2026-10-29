/**
 * Settings (Paper MX-G): Appearance with a card per dark, then Hosts, Notifications and Motion.
 * Notifications opens iOS Settings for Polaris; the app has no screen of its own for them yet.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import {
  ActionSheetIOS,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { useMotionPreference, useTheme } from "../theme";
import { Chevron, HostsGlyph, MotionGlyph, NotificationsGlyph } from "./icons.tsx";
import { hostsLine, MOTION_CHOICES, motionLine, THEME_CARDS } from "./model.ts";
import { ThemeCard } from "./ThemeCard.tsx";

const Row = ({
  Glyph,
  title,
  line,
  note = null,
  last = false,
  onPress,
}: {
  readonly Glyph: (props: { readonly color: string }) => React.JSX.Element;
  readonly title: string;
  readonly line: string;
  readonly note?: string | null;
  readonly last?: boolean;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}${note === null ? "" : `, ${note}`}`}
      onPress={onPress}
      style={[
        styles.row,
        last ? null : { borderBottomColor: colours.hairline, borderBottomWidth: 1 },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: colours.raised }]}>
        <Glyph color={colours.textDefault} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colours.textStrong }]}>{title}</Text>
        <Text style={[styles.rowLine, { color: colours.textSubtle }]} numberOfLines={1}>
          {line}
          {note === null ? null : <Text style={{ color: colours.needsYouText }}> · {note}</Text>}
        </Text>
      </View>
      <Chevron color={colours.textFaint} />
    </Pressable>
  );
};

const chooseMotion = (setMotion: (motion: (typeof MOTION_CHOICES)[number]["motion"]) => void) =>
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Motion",
      options: [...MOTION_CHOICES.map((choice) => choice.label), "Cancel"],
      cancelButtonIndex: MOTION_CHOICES.length,
    },
    (index) => {
      const choice = MOTION_CHOICES[index];

      if (choice !== undefined) setMotion(choice.motion);
    }
  );

export const SettingsScreen = ({
  tabBarHeight,
  onHosts,
}: {
  readonly tabBarHeight: number;
  readonly onHosts: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const { colours } = useTheme();
  const { motion, setMotion } = useMotionPreference();

  const hosts = hostsLine(
    useFollowedHosts().map(({ connection, status }) => ({
      name: status.host?.hostname ?? connection.name,
      state: status.state,
    }))
  );

  const panel = { backgroundColor: colours.panel, borderColor: colours.hairline };

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: tabBarHeight + 24 }}
    >
      <Text style={[styles.large, { color: colours.textStrong }]} accessibilityRole="header">
        Settings
      </Text>
      <View style={styles.panels}>
        <View style={[styles.panel, styles.appearance, panel]}>
          <Text style={[styles.kicker, { color: colours.textSubtle }]} accessibilityRole="header">
            APPEARANCE
          </Text>
          <View style={styles.cards} accessibilityRole="radiogroup">
            {THEME_CARDS.map((card) => (
              <ThemeCard key={card.name} {...card} />
            ))}
          </View>
        </View>
        <View style={[styles.panel, styles.links, panel]}>
          <Row
            Glyph={HostsGlyph}
            title="Hosts"
            line={hosts.names}
            note={hosts.note}
            onPress={onHosts}
          />
          <Row
            Glyph={NotificationsGlyph}
            title="Notifications"
            line="In iOS Settings"
            onPress={() => void Linking.openSettings()}
          />
          <Row
            Glyph={MotionGlyph}
            title="Motion"
            line={motionLine(motion)}
            last
            onPress={() => chooseMotion(setMotion)}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  large: { ...mobileType.largeTitle, paddingHorizontal: 16, paddingBottom: 14 },
  panels: { paddingHorizontal: 10, gap: 10 },
  panel: { borderRadius: 22, borderWidth: 1 },
  appearance: { gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16 },
  links: { paddingHorizontal: 12, paddingVertical: 2 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
  },
  cards: { flexDirection: "row", gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  tile: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { ...mobileType.heading },
  rowLine: { ...mobileType.footnote },
});
