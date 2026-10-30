/**
 * The floating tab pill (Paper MX-C, MX-G): Sessions, Review and Settings as a panel on the
 * ground, and New beside it filled in Starlight.
 */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "../theme";
import { TAB_TEXT_SCALE } from "../theme/textScale.ts";
import { HOME_TABS, type HomeTab } from "./navigationState.ts";

type Icon = (props: { readonly color: string }) => React.JSX.Element;

const SessionsIcon: Icon = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 20 20">
    <Rect x={3} y={4} width={14} height={3} rx={1} fill={color} />
    <Rect x={3} y={9} width={14} height={3} rx={1} fill={color} />
    <Rect x={3} y={14} width={9} height={3} rx={1} fill={color} />
  </Svg>
);

const ReviewIcon: Icon = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 20 20">
    <Path
      d="M4 4h12v9H9l-4 3v-3H4z"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </Svg>
);

const SettingsIcon: Icon = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={2.6} fill="none" stroke={color} strokeWidth={1.6} />
    <Path
      d="M10 2.8v2.1M10 15.1v2.1M2.8 10h2.1M15.1 10h2.1M4.9 4.9l1.5 1.5M13.6 13.6l1.5 1.5M4.9 15.1l1.5-1.5M13.6 6.4l1.5-1.5"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  </Svg>
);

const TABS: Record<HomeTab, { readonly label: string; readonly Icon: Icon }> = {
  sessions: { label: "Sessions", Icon: SessionsIcon },
  review: { label: "Review", Icon: ReviewIcon },
  settings: { label: "Settings", Icon: SettingsIcon },
};

export const TabBar = ({
  active,
  reviewCount,
  bottom,
  onSelect,
  onNew,
  newDimmed = false,
}: {
  readonly active: HomeTab;
  readonly reviewCount: number;
  readonly bottom: number;
  readonly onSelect: (tab: HomeTab) => void;
  readonly onNew: () => void;
  /** No Host to start one on (MX-AV's "No hosts yet"): New dims and does nothing. */
  readonly newDimmed?: boolean;
}) => {
  const { colours } = useTheme();
  const panel = { backgroundColor: colours.panel, borderColor: colours.hairline };

  return (
    <View style={[styles.row, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, panel]} accessibilityRole="tablist">
        {HOME_TABS.map((tab) => {
          const { label, Icon } = TABS[tab];
          const selected = tab === active;
          const color = selected ? colours.textStrong : colours.textSubtle;
          const counted = tab === "review" && reviewCount > 0;

          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={counted ? `${label}, ${reviewCount} ready` : label}
              onPress={() => onSelect(tab)}
              style={[styles.tab, selected ? { backgroundColor: colours.raised } : null]}
            >
              <Icon color={color} />
              <Text
                style={[styles.label, { color }]}
                maxFontSizeMultiplier={TAB_TEXT_SCALE}
                numberOfLines={1}
              >
                {counted ? `${label} · ${reviewCount}` : label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New agent session"
        accessibilityState={{ disabled: newDimmed }}
        disabled={newDimmed}
        onPress={onNew}
        style={[styles.new, { backgroundColor: colours.starlight }, newDimmed && styles.dimmed]}
      >
        <Svg width={22} height={22} viewBox="0 0 16 16">
          <Path
            d="M8 3v10M3 8h10"
            stroke={colours.ground}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  dimmed: { opacity: 0.35 },
  row: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bar: {
    flex: 1,
    height: 58,
    padding: 4,
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
  },
  tab: {
    flex: 1,
    height: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 4,
  },
  label: { ...mobileType.tab },
  new: { width: 58, height: 58, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
