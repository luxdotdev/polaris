/**
 * With no Harness ready on the Host (Paper MX-AR): a panel naming each one's reason and its fix
 * on the Host, its setup guide when missing or too old, and Check again. Neutral, never a signal.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Linking, Pressable, Text, View } from "react-native";
import { Celestial, sessionCelestial } from "../celestial";
import { themedStyles } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import type { NotReadyHarness } from "./harness.ts";

const HarnessWell = ({ harness }: { readonly harness: NotReadyHarness }) => {
  const styles = useStyles();
  const { docsUrl } = harness;

  return (
    <View style={styles.well}>
      <Celestial body={sessionCelestial(null)} harness={harness.kind} size={16} />
      <View style={styles.text}>
        <Text style={styles.reason} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {harness.reason}
        </Text>
        <Text style={styles.remedy} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {harness.remedy}
        </Text>
        {docsUrl === null ? null : (
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            style={styles.guide}
            onPress={() => void Linking.openURL(docsUrl)}
          >
            <Text style={styles.action}>Open setup guide ↗</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

export const NotReadyPanel = ({
  hostName,
  harnesses,
  onCheckAgain,
}: {
  readonly hostName: string;
  readonly harnesses: ReadonlyArray<NotReadyHarness>;
  readonly onCheckAgain: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.panel}>
      <Text style={styles.kicker} numberOfLines={1}>
        {`No harness ready on ${hostName}`.toUpperCase()}
      </Text>
      <Text style={styles.lead} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        Polaris drives the harnesses you already have. Set one up on {hostName}, then check again.
      </Text>
      {harnesses.map((harness) => (
        <HarnessWell key={harness.kind} harness={harness} />
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={onCheckAgain}
        style={({ pressed }) => [styles.checkAgain, pressed ? styles.pressed : null]}
      >
        <Text style={styles.checkLabel}>Check again</Text>
      </Pressable>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: {
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
  },
  lead: { ...mobileType.callout, color: colours.textDefault },
  well: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  text: { flex: 1, minWidth: 0, gap: 4 },
  reason: { fontFamily: mobileFont.mono, fontSize: 13, lineHeight: 18, color: colours.textStrong },
  remedy: { ...mobileType.footnote, color: colours.textSubtle },
  guide: { alignSelf: "flex-start", paddingTop: 4 },
  action: { ...mobileType.subhead, fontWeight: "500", color: colours.textDefault },
  checkAgain: {
    height: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  checkLabel: { ...mobileType.heading, fontWeight: "500", color: colours.textStrong },
}));
