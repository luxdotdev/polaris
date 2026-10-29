/**
 * A top-level screen's empty, offline or error state (DESIGN.md, Mobile chrome redesign · phase 3;
 * Paper MX-AV): the horizon raised mid-screen, a dimmed celestial on it, one line, one action.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Horizon, HORIZON_HEIGHT } from "../horizon/index.tsx";
import { PALETTES } from "../horizon/scene.ts";
import { themedStyles, useTheme } from "../theme/index.ts";

/** The one action under the line: `primary` is the filled pill (Link this iPhone). */
export interface StateAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
}

interface Common {
  /** "No hosts yet", "Can't reach your hosts", "Nothing to review". */
  readonly title: string;
  /** Celestials standing on the ridge, drawn dimmed; leave out for none. */
  readonly celestials?: ReactNode;
  /** An inline amber "Reconnecting · <detail>" under the line ("Polaris keeps trying"). */
  readonly reconnecting?: string;
  /** At most one. */
  readonly action?: StateAction;
}

export type StatePanelProps = Common &
  (
    | { /** One explanatory line. */ readonly line: string; readonly failure?: never }
    | {
        /** The failure text as the Host gave it, in mono. */ readonly failure: string;
        readonly line?: never;
      }
    | { readonly line?: never; readonly failure?: never }
  );

/** MX-AV's raised horizon: it stands this far below the screen's header. */
export const STATE_HORIZON_TOP = 96;

/** Where the celestials stand on the ridge, from the scene's top. */
const CELESTIAL_TOP = 118;

const CELESTIAL_OPACITY = 0.35;

/** How far under the ridge its colour lasts before it is the ground. */
const FADE_HEIGHT = 180;

const fadeStyles = StyleSheet.create({
  fade: { position: "absolute", top: 0, left: 0, height: FADE_HEIGHT },
});

/** The front ridge's colour fading into the ground under the copy. */
const Fade = () => {
  const { name, colours } = useTheme();
  const { width } = useWindowDimensions();

  return (
    <View style={[fadeStyles.fade, { width }]} pointerEvents="none">
      <Svg width={width} height={FADE_HEIGHT}>
        <Defs>
          <LinearGradient id="state-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={PALETTES[name].front} />
            <Stop offset="1" stopColor={colours.ground} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={FADE_HEIGHT} fill="url(#state-fade)" />
      </Svg>
    </View>
  );
};

/** A ring in the needs you colour and "Reconnecting · <detail>". */
const Reconnecting = ({ detail }: { readonly detail: string }) => {
  const styles = useStyles();

  return (
    <View style={styles.reconnecting}>
      <View style={styles.ring} />
      <Text style={styles.reconnectingText}>Reconnecting · {detail}</Text>
    </View>
  );
};

const Action = ({ label, onPress, primary = false }: StateAction) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
};

/**
 * MX-AV's top-level state, placed under the screen's large title: EmptyHome's "No hosts yet" and
 * "Can't reach your hosts", ReviewTab's "Nothing to review". Give a `line` or a `failure`, not both.
 */
export const StatePanel = (props: StatePanelProps) => {
  const styles = useStyles();
  const { title, celestials, reconnecting, action, line, failure } = props;

  return (
    <View style={styles.panel}>
      <View style={styles.scene}>
        <Horizon />
        {celestials === undefined ? null : (
          <View style={styles.celestials} pointerEvents="none">
            {celestials}
          </View>
        )}
      </View>
      <View style={styles.copy}>
        <Fade />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {line === undefined ? null : <Text style={styles.line}>{line}</Text>}
        {failure === undefined ? null : <Text style={styles.failure}>{failure}</Text>}
        {reconnecting === undefined ? null : <Reconnecting detail={reconnecting} />}
        {action === undefined ? null : <Action {...action} />}
      </View>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: { marginTop: STATE_HORIZON_TOP },
  scene: { height: HORIZON_HEIGHT, overflow: "hidden" },
  celestials: {
    position: "absolute",
    top: CELESTIAL_TOP,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 44,
    opacity: CELESTIAL_OPACITY,
  },
  copy: { alignItems: "center", gap: 8, paddingHorizontal: 40, paddingTop: 28, paddingBottom: 8 },
  title: {
    fontFamily: mobileFont.sans,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: colours.textStrong,
    textAlign: "center",
  },
  line: { ...mobileType.callout, lineHeight: 20, color: colours.textSubtle, textAlign: "center" },
  failure: {
    fontFamily: mobileFont.mono,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    color: colours.failedText,
    textAlign: "center",
  },
  reconnecting: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  ring: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colours.needsYou },
  reconnectingText: { ...mobileType.footnote, color: colours.textSubtle, textAlign: "center" },
  action: {
    height: 44,
    marginTop: 12,
    paddingHorizontal: 22,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { marginTop: 14, backgroundColor: colours.textStrong },
  secondary: { borderWidth: 1, borderColor: colours.hairline, backgroundColor: colours.raised },
  actionText: { ...mobileType.heading, fontWeight: "600", color: colours.textStrong },
  primaryText: { color: colours.panel },
  pressed: { transform: [{ scale: 0.97 }] },
}));
