/**
 * The states pattern inside a thread (DESIGN.md, Mobile chrome redesign · phase 3; Paper MX-AV):
 * nothing becomes a banner. A line above the composer, and a footnote under a message's bubble.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { type MobileColours, themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE, CONTROL_TEXT_SCALE } from "../theme/textScale.ts";

export interface ReconnectingLineProps {
  /** The Host's name ("lucas-rpi"). */
  readonly host: string;
  readonly onRetry: () => void;
}

/** "Reconnecting to <host>…" with Retry now, above the composer while the Host is away. */
export const ReconnectingLine = ({ host, onRetry }: ReconnectingLineProps) => {
  const styles = useStyles();

  return (
    <View style={styles.line} accessibilityLiveRegion="polite">
      <View style={styles.ring} />
      <Text maxFontSizeMultiplier={CONTROL_TEXT_SCALE} style={styles.lineText} numberOfLines={1}>
        Reconnecting to {host}…
      </Text>
      <Pressable accessibilityRole="button" hitSlop={10} onPress={onRetry}>
        {({ pressed }) => (
          <Text
            maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
            style={[styles.retry, pressed && styles.dim]}
          >
            Retry now
          </Text>
        )}
      </Pressable>
    </View>
  );
};

/** What a sent message is waiting on, if anything. */
export type BubbleState =
  | {
      /** Sent while the Host was away; it goes when the Host is back. */
      readonly kind: "queued";
      readonly host: string;
    }
  | {
      readonly kind: "failed";
      /** The failure as the Host or the Client gave it; shown in mono. */
      readonly message: string;
      readonly onSendAgain: () => void;
    };

/** The failed colour at 40%, MX-AV's outline. */
const outlineOf = (colours: MobileColours) => `${colours.failed}66`;

/**
 * The bubble's own treatment for its state: a failed send is outlined in the failed colour and its
 * text recedes; spread `view` on the bubble and `text` on its text. Empty for every other state.
 */
export const useBubbleTreatment = (
  state: BubbleState | null
): { readonly view?: ViewStyle; readonly text?: TextStyle } => {
  const { colours } = useTheme();

  return state?.kind === "failed"
    ? { view: { borderColor: outlineOf(colours) }, text: { color: colours.textSubtle } }
    : {};
};

const FailedMark = ({ color }: { readonly color: string }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14" style={{ marginTop: 2 }}>
    <Circle cx={7} cy={7} r={6} fill="none" stroke={color} strokeWidth={1.4} />
    <Path d="M7 3.8v3.8" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    <Circle cx={7} cy={9.9} r={0.9} fill={color} />
  </Svg>
);

/**
 * The slot under a message's bubble: "Queued · sends when <host> is back" in text-faint, or the
 * failure in mono with Send again. Place it straight under the bubble; nothing for `null`.
 */
export const BubbleFootnote = ({ state }: { readonly state: BubbleState | null }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  if (state === null) return null;

  if (state.kind === "queued")
    return (
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.queued}>
        Queued · sends when {state.host} is back
      </Text>
    );

  return (
    <View style={styles.failedBlock}>
      <View style={styles.failure} accessibilityLiveRegion="assertive">
        <FailedMark color={colours.failed} />
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.failureText}>
          {state.message}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={state.onSendAgain}
        style={({ pressed }) => [styles.sendAgain, pressed && styles.pressed]}
      >
        <Text maxFontSizeMultiplier={CONTROL_TEXT_SCALE} style={styles.sendAgainText}>
          Send again
        </Text>
      </Pressable>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  line: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10 },
  ring: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colours.needsYou },
  lineText: { ...mobileType.footnote, flex: 1, color: colours.textDefault },
  retry: { ...mobileType.footnote, fontWeight: "600", color: colours.textStrong },
  dim: { opacity: 0.6 },
  queued: {
    ...mobileType.footnote,
    fontSize: 12,
    lineHeight: 16,
    alignSelf: "flex-end",
    marginTop: 6,
    paddingRight: 6,
    color: colours.textFaint,
  },
  failedBlock: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 8,
    maxWidth: 330,
  },
  failure: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 4 },
  failureText: {
    flexShrink: 1,
    fontFamily: mobileFont.mono,
    fontSize: 12,
    lineHeight: 17,
    color: colours.failedText,
  },
  sendAgain: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  sendAgainText: { ...mobileType.subhead, fontWeight: "600", color: colours.textStrong },
  pressed: { transform: [{ scale: 0.97 }] },
}));
