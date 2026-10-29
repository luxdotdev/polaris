/**
 * The Critical confirmation (Paper MX-T): a sheet naming the open Criticals, with Ask {agent},
 * Accept anyway and Cancel. It sizes itself to its content.
 */
import type { RiskFinding } from "@polaris/protocol";
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { InstrumentSheet } from "../../sheet/index.tsx";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { confirmationBody, confirmationTitle } from "./confirmation.ts";
import type { AcceptReview } from "./useAcceptReview.ts";

export interface CriticalConfirmationProps extends Pick<
  AcceptReview,
  "confirming" | "confirm" | "dismiss"
> {
  readonly turnNumber?: number;
  /** The agent session's Harness ("Claude Code"), named by the ask button. */
  readonly agentName?: string;
  /** Asks the agent about the listed Criticals; without it the sheet has no ask button. */
  readonly onAsk?: (criticals: ReadonlyArray<RiskFinding>) => void;
}

/** The grabber row, the frame's top padding and the gap above the body. */
const SHEET_CHROME = 8 + 9 + 10;

/** A first guess at the content's height, before it has laid out. */
const ESTIMATE = 400;

const Diamond = ({ size, color }: { readonly size: number; readonly color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 8 8">
    <Path d="M4 0L8 4 4 8 0 4z" fill={color} />
  </Svg>
);

const CriticalRow = ({ finding }: { readonly finding: RiskFinding }) => {
  const styles = useStyles();

  return (
    <View style={styles.critical}>
      <View style={styles.criticalHead}>
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.kicker}>
          Critical
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.criticalTitle}>
          {finding.title}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.path}>
        {`${finding.path}:${finding.lines.start}`}
      </Text>
    </View>
  );
};

interface ContentProps extends CriticalConfirmationProps {
  readonly criticals: ReadonlyArray<RiskFinding>;
}

const Content = ({ criticals, confirm, dismiss, turnNumber, agentName, onAsk }: ContentProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const asks = onAsk !== undefined && agentName !== undefined;

  return (
    <>
      <View style={styles.intro}>
        <View style={styles.mark}>
          <Diamond size={16} color={colours.severityCritical} />
        </View>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          style={styles.title}
        >
          {confirmationTitle(criticals.length, turnNumber)}
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.body}>
          {confirmationBody(criticals.length, asks ? agentName : undefined)}
        </Text>
      </View>
      {criticals.map((finding) => (
        <CriticalRow key={finding.id} finding={finding} />
      ))}
      <View style={styles.actions}>
        {asks ? (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, styles.ask, pressed && styles.pressed]}
            onPress={() => {
              dismiss();
              onAsk(criticals);
            }}
          >
            <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.askText}>
              {`Ask ${agentName} about it`}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, styles.anyway, pressed && styles.pressed]}
          onPress={confirm}
        >
          <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.anywayText}>
            Accept anyway
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          onPress={dismiss}
        >
          <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.cancelText}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </>
  );
};

export const CriticalConfirmation = (props: CriticalConfirmationProps) => {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(ESTIMATE);

  // Keeps the last Criticals while the sheet animates closed.
  const [shown, setShown] = useState<ReadonlyArray<RiskFinding>>([]);

  if (props.confirming !== null && props.confirming !== shown) setShown(props.confirming);

  return (
    <InstrumentSheet
      open={props.confirming !== null}
      onClose={props.dismiss}
      detents={[height + SHEET_CHROME + Math.max(insets.bottom, 16)]}
    >
      <View
        style={styles.content}
        onLayout={({ nativeEvent }) => setHeight(Math.ceil(nativeEvent.layout.height))}
      >
        <Content {...props} criticals={props.confirming ?? shown} />
      </View>
    </InstrumentSheet>
  );
};

const SEMIBOLD = "600";

const useStyles = themedStyles((colours) => ({
  content: { gap: 16, paddingHorizontal: 10, paddingBottom: 18 },
  intro: { gap: 12, paddingTop: 6 },
  mark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.severityCriticalFill,
    borderWidth: 1,
    borderColor: `${colours.severityCritical}40`,
  },
  title: {
    ...mobileType.title,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: SEMIBOLD,
    color: colours.textStrong,
  },
  body: { ...mobileType.callout, color: colours.textSubtle },
  critical: {
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${colours.severityCritical}40`,
    backgroundColor: `${colours.severityCritical}14`,
  },
  criticalHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: colours.severityCriticalText,
  },
  criticalTitle: { ...mobileType.label, lineHeight: 20, flex: 1, color: colours.textStrong },
  path: { ...mobileType.index, fontSize: 12, lineHeight: 17, color: colours.textSubtle },
  actions: { gap: 10, paddingTop: 4 },
  button: { height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  ask: { backgroundColor: colours.textStrong },
  askText: { ...mobileType.body, fontWeight: SEMIBOLD, color: colours.panel },
  anyway: {
    backgroundColor: colours.raised,
    borderWidth: 1,
    borderColor: `${colours.textStrong}1f`,
  },
  anywayText: { ...mobileType.body, fontWeight: SEMIBOLD, color: colours.severityCriticalText },
  cancel: { height: 40, alignItems: "center", justifyContent: "center" },
  cancelText: { ...mobileType.heading, color: colours.textSubtle },
  pressed: { opacity: 0.7 },
}));
